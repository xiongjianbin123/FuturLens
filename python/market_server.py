"""
FuturLens 行情 WebSocket 服务器
================================
架构：
  ┌─────────────────────────────────────────────────────┐
  │  主线程 (asyncio)                                    │
  │  ┌──────────────────┐    ┌──────────────────────┐   │
  │  │  WebSocket 服务   │◄───│  asyncio.Queue        │   │
  │  │  (websockets lib) │    │  (线程安全数据桥)    │   │
  │  └──────────────────┘    └──────────┬───────────┘   │
  └─────────────────────────────────────┼───────────────┘
                                        │ put_nowait
  ┌─────────────────────────────────────▼───────────────┐
  │  后台线程 (TqSdk)                                    │
  │  TqApi.wait_update() → 检测变化 → 放入队列           │
  └─────────────────────────────────────────────────────┘

账号配置：在 python/.env 文件中填写（参考 .env.example）

启动命令：
  python market_server.py            # 读取 .env 文件
  python market_server.py --sim      # 模拟行情（无需账号）
  python market_server.py --symbol SHFE.rb2505 --symbol DCE.m2509
"""

import asyncio
import json
import logging
import math
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Set
import argparse

import websockets
from websockets.server import WebSocketServerProtocol
from dotenv import load_dotenv

# ─── 加载 .env 配置 ───────────────────────────────────────────────────────────
# 优先查找 python/.env，再查找项目根目录 .env
_env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=_env_path if _env_path.exists() else Path(__file__).parent.parent / '.env')

TQ_ACCOUNT  = os.getenv('TQ_ACCOUNT', '')
TQ_PASSWORD = os.getenv('TQ_PASSWORD', '')
WS_PORT     = int(os.getenv('WS_PORT', '8765'))
KLINE_PERIOD = int(os.getenv('KLINE_PERIOD', '60'))
KLINE_COUNT  = int(os.getenv('KLINE_COUNT', '300'))
DEFAULT_SYMBOLS = [s.strip() for s in os.getenv('DEFAULT_SYMBOLS', 'SHFE.rb2505').split(',')]

# ─── 日志配置 ─────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('FuturLens')

# ─── 全局状态 ─────────────────────────────────────────────────────────────────
connected_clients: Set[WebSocketServerProtocol] = set()
client_subscriptions: Dict[WebSocketServerProtocol, str] = {}


# ─── 工具函数 ─────────────────────────────────────────────────────────────────
def _safe_float(v) -> Optional[float]:
    """将 TqSdk 数值转为安全的 float（过滤 NaN / Inf）"""
    try:
        f = float(v)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _safe_int(v) -> int:
    try:
        f = float(v)
        return 0 if math.isnan(f) else int(f)
    except (TypeError, ValueError):
        return 0


def kline_row_to_dict(row, period_seconds: int) -> Optional[dict]:
    """
    将 TqSdk DataFrame 行转为前端 CandlestickData 格式。
    返回 None 表示该行数据无效（全为 NaN）。
    """
    # TqSdk datetime 字段：纳秒时间戳
    ts_ns = row.get('datetime', 0) or row.get('id', 0)
    ts = int(ts_ns) // 1_000_000_000  # 纳秒 → 秒

    # 时间戳为 0 或负数则跳过
    if ts <= 0:
        return None

    o = _safe_float(row.get('open'))
    h = _safe_float(row.get('high'))
    l = _safe_float(row.get('low'))
    c = _safe_float(row.get('close'))

    if any(v is None for v in [o, h, l, c]):
        return None

    return {
        'time':   ts,
        'open':   o,
        'high':   h,
        'low':    l,
        'close':  c,
        'volume': _safe_int(row.get('volume')),
    }


def quote_to_tick_dict(quote, ts: float) -> Optional[dict]:
    """将 TqSdk Quote 对象转为 Tick 字典"""
    price = _safe_float(quote.last_price)
    if price is None:
        return None

    return {
        'time':          int(ts),
        'price':         price,
        'volume':        _safe_int(quote.volume),
        'bid':           _safe_float(quote.bid_price1) or price,
        'ask':           _safe_float(quote.ask_price1) or price,
        'open_interest': _safe_int(quote.open_interest),
        'upper_limit':   _safe_float(quote.upper_limit),
        'lower_limit':   _safe_float(quote.lower_limit),
        'pre_close':     _safe_float(quote.pre_close),
    }


def normalize_symbol(symbol: str) -> str:
    """
    将简短代码转为天勤完整格式：
      rb2505  → SHFE.rb2505
      m2509   → DCE.m2509
      MA509   → CZCE.MA509
      IF2506  → CFFEX.IF2506
    """
    if '.' in symbol:
        return symbol

    s = symbol.lower()
    prefix = ''.join(filter(str.isalpha, s))

    SHFE  = {'rb','hc','au','ag','cu','al','zn','pb','ni','sn','ss','fu','ru','bu','sp'}
    DCE   = {'m','a','b','c','cs','jd','lh','bb','fb','p','y','l','v','pp','j','jm',
             'i','eg','eb','rr','pg'}
    CZCE  = {'cf','sr','ta','ma','rm','oi','rs','wh','pm','ri','jr','lr','cy','ap',
             'cj','pk','ur','sa','pf','sm','sf'}
    CFFEX = {'if','ic','ih','im','tf','ts','tl','t'}
    INE   = {'sc','lu','bc','nr'}

    if prefix in SHFE:
        return f'SHFE.{symbol}'
    if prefix in DCE:
        return f'DCE.{symbol}'
    if prefix in CZCE:
        return f'CZCE.{symbol.upper()}'
    if prefix in CFFEX:
        return f'CFFEX.{symbol.upper()}'
    if prefix in INE:
        return f'INE.{symbol}'

    logger.warning(f'未知品种前缀 "{prefix}"，默认归属 SHFE')
    return f'SHFE.{symbol}'


# ─── 广播 ─────────────────────────────────────────────────────────────────────
async def broadcast(message: dict, target_symbol: Optional[str] = None) -> None:
    if not connected_clients:
        return
    data = json.dumps(message, ensure_ascii=False)
    targets = {
        c for c in connected_clients
        if target_symbol is None or client_subscriptions.get(c) == target_symbol
    }
    if targets:
        await asyncio.gather(*[c.send(data) for c in targets], return_exceptions=True)


# ─── TqSdk 后台线程 ───────────────────────────────────────────────────────────
class TqWorker(threading.Thread):
    """
    在独立线程中运行 TqSdk 同步循环，将行情数据通过 asyncio.Queue 发给主线程。

    之所以需要独立线程：
      TqSdk 的 wait_update() 是阻塞调用，不能直接在 asyncio 事件循环中调用，
      否则会阻塞整个 WebSocket 服务。
    """

    def __init__(
        self,
        api,                        # TqApi 实例（调用方传入）
        symbol: str,
        queue: asyncio.Queue,
        loop: asyncio.AbstractEventLoop,
        kline_period: int = 60,
        kline_count: int = 300,
    ):
        super().__init__(daemon=True, name=f'TqWorker-{symbol}')
        self.api        = api
        self.symbol     = symbol
        self.queue      = queue
        self.loop       = loop
        self.kline_period = kline_period
        self.kline_count  = kline_count
        self._stop_flag   = threading.Event()

    def _put(self, message: dict) -> None:
        """线程安全地将消息放入 asyncio.Queue"""
        self.loop.call_soon_threadsafe(self.queue.put_nowait, message)

    def run(self) -> None:
        logger.info(f'[{self.symbol}] TqSdk 线程启动')
        try:
            self._subscribe_and_push()
        except Exception as e:
            logger.error(f'[{self.symbol}] TqSdk 线程异常: {e}', exc_info=True)
            self._put({'type': 'error', 'symbol': self.symbol, 'message': str(e)})

    def _subscribe_and_push(self) -> None:
        api    = self.api
        symbol = self.symbol

        # 订阅 K 线序列和实时行情
        klines = api.get_kline_serial(symbol, self.kline_period, data_length=self.kline_count)
        quote  = api.get_quote(symbol)

        # ── 等待首次数据到达 ──
        deadline = time.time() + 30  # 最多等 30 秒
        while not api.is_changing(klines, quote):
            api.wait_update()
            if time.time() > deadline:
                raise TimeoutError(f'{symbol} 行情数据超时，请检查品种代码或网络')

        # ── 推送历史 K 线 ──
        history = []
        for i in range(len(klines)):
            row  = klines.iloc[i]
            item = kline_row_to_dict(row, self.kline_period)
            if item:
                history.append(item)

        if history:
            self._put({'type': 'history', 'symbol': symbol, 'data': history})
            logger.info(f'[{symbol}] 历史 K 线已推送，共 {len(history)} 根')
        else:
            logger.warning(f'[{symbol}] 历史 K 线为空，可能在非交易时段')

        # ── 实时推送循环 ──
        last_kline_ts  = 0
        last_tick_ts   = 0.0
        TICK_INTERVAL  = 0.2  # Tick 最高推送频率：5次/秒

        while not self._stop_flag.is_set():
            api.wait_update()
            now = time.time()

            # 检测 K 线变化
            if api.is_changing(klines):
                latest = klines.iloc[-1]
                item   = kline_row_to_dict(latest, self.kline_period)
                if item and item['time'] != last_kline_ts:
                    last_kline_ts = item['time']
                    self._put({'type': 'candle', 'symbol': symbol, 'data': item})

            # 检测 Tick 变化（限频）
            if api.is_changing(quote) and (now - last_tick_ts) >= TICK_INTERVAL:
                last_tick_ts = now
                tick = quote_to_tick_dict(quote, now)
                if tick:
                    self._put({'type': 'tick', 'symbol': symbol, 'data': tick})

    def stop(self) -> None:
        self._stop_flag.set()


# ─── WebSocket 服务器 ─────────────────────────────────────────────────────────
class MarketServer:

    def __init__(self, api, loop: asyncio.AbstractEventLoop, sim_mode: bool):
        self.api      = api
        self.loop     = loop
        self.sim_mode = sim_mode
        self.queue: asyncio.Queue = asyncio.Queue()
        self.workers: Dict[str, TqWorker] = {}

    async def handle_client(self, websocket: WebSocketServerProtocol) -> None:
        connected_clients.add(websocket)
        addr = websocket.remote_address
        logger.info(f'客户端接入: {addr}  (当前连接数: {len(connected_clients)})')

        # 发送服务器信息
        await websocket.send(json.dumps({
            'type':    'server_info',
            'version': '2.0',
            'sim':     self.sim_mode,
            'message': '已连接 FuturLens 行情服务器',
        }))

        try:
            async for raw in websocket:
                try:
                    await self._on_message(websocket, json.loads(raw))
                except json.JSONDecodeError:
                    logger.warning(f'非法消息（非 JSON）: {raw[:80]}')
                except Exception as e:
                    logger.error(f'消息处理异常: {e}', exc_info=True)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            connected_clients.discard(websocket)
            client_subscriptions.pop(websocket, None)
            logger.info(f'客户端断开: {addr}  (剩余连接数: {len(connected_clients)})')

    async def _on_message(self, ws: WebSocketServerProtocol, msg: dict) -> None:
        t = msg.get('type')

        if t == 'subscribe':
            raw_symbol = msg.get('symbol', DEFAULT_SYMBOLS[0])
            symbol     = normalize_symbol(raw_symbol)
            client_subscriptions[ws] = symbol
            logger.info(f'订阅品种: {symbol}')
            self._ensure_worker(symbol)

        elif t == 'unsubscribe':
            client_subscriptions.pop(ws, None)

        elif t == 'ping':
            await ws.send(json.dumps({'type': 'pong', 'ts': time.time()}))

        else:
            logger.debug(f'未知消息类型: {t}')

    def _ensure_worker(self, symbol: str) -> None:
        """如果该品种的 TqSdk 线程尚未启动，则启动之"""
        if symbol in self.workers:
            return
        worker = TqWorker(
            api=self.api,
            symbol=symbol,
            queue=self.queue,
            loop=self.loop,
            kline_period=KLINE_PERIOD,
            kline_count=KLINE_COUNT,
        )
        self.workers[symbol] = worker
        worker.start()
        logger.info(f'[{symbol}] 行情线程已启动')

    async def dispatch_loop(self) -> None:
        """从队列中取出数据并广播给对应的订阅客户端"""
        while True:
            msg = await self.queue.get()
            sym = msg.get('symbol')
            try:
                await broadcast(msg, target_symbol=sym)
            except Exception as e:
                logger.error(f'广播失败: {e}')
            finally:
                self.queue.task_done()

    def start_default_workers(self) -> None:
        for sym in DEFAULT_SYMBOLS:
            self._ensure_worker(sym)


# ─── 主入口 ───────────────────────────────────────────────────────────────────
async def run(args: argparse.Namespace) -> None:
    from tqsdk import TqApi, TqAuth, TqSim

    loop = asyncio.get_running_loop()

    # ── 创建 TqApi ──
    sim_mode = args.sim or not (TQ_ACCOUNT and TQ_PASSWORD)
    if sim_mode:
        if not args.sim:
            logger.warning('未找到 TQ_ACCOUNT / TQ_PASSWORD，自动切换为模拟行情')
        logger.info('行情模式: TqSim（模拟）')
        api = TqApi(TqSim(), web_gui=False)
    else:
        logger.info(f'行情模式: 实盘  账号: {TQ_ACCOUNT}')
        api = TqApi(auth=TqAuth(TQ_ACCOUNT, TQ_PASSWORD), web_gui=False)

    server = MarketServer(api=api, loop=loop, sim_mode=sim_mode)
    server.start_default_workers()

    host = '127.0.0.1'
    port = args.port or WS_PORT

    async with websockets.serve(
        server.handle_client,
        host,
        port,
        ping_interval=20,
        ping_timeout=10,
        max_size=16 * 1024 * 1024,   # 16 MB（历史数据）
    ):
        logger.info('═' * 50)
        logger.info(f'  FuturLens 行情服务器已启动')
        logger.info(f'  地址: ws://{host}:{port}')
        logger.info(f'  默认品种: {", ".join(DEFAULT_SYMBOLS)}')
        logger.info(f'  K 线周期: {KLINE_PERIOD}s  历史: {KLINE_COUNT} 根')
        logger.info('  按 Ctrl+C 停止')
        logger.info('═' * 50)

        try:
            # 同时运行：WebSocket 服务 + 数据分发循环
            await asyncio.gather(
                asyncio.Future(),       # 永久运行（等待 Ctrl+C）
                server.dispatch_loop(), # 队列分发
            )
        except asyncio.CancelledError:
            pass
        finally:
            for w in server.workers.values():
                w.stop()
            api.close()
            logger.info('服务器已安全关闭')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FuturLens 行情 WebSocket 服务器')
    parser.add_argument(
        '--sim',
        action='store_true',
        help='强制使用模拟行情（忽略 .env 中的账号）'
    )
    parser.add_argument(
        '--symbol',
        action='append',
        dest='symbols',
        metavar='SYMBOL',
        help='启动时预订阅的品种（可多次指定，如 --symbol SHFE.rb2505 --symbol DCE.m2509）'
    )
    parser.add_argument(
        '--port',
        type=int,
        default=0,
        help=f'WebSocket 端口（默认读取 .env 中 WS_PORT，当前={WS_PORT}）'
    )
    args = parser.parse_args()

    # 命令行指定的品种覆盖环境变量
    if args.symbols:
        DEFAULT_SYMBOLS.clear()
        DEFAULT_SYMBOLS.extend(normalize_symbol(s) for s in args.symbols)

    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        logger.info('收到 Ctrl+C，服务器已停止')
