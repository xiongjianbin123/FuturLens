"""
FuturLens 行情 WebSocket 服务器
================================
依赖安装：
    pip install tqsdk websockets asyncio

使用方法：
    python market_server.py

    # 或指定账户（实盘）：
    python market_server.py --account 你的天勤账号 --password 你的密码

    # 仅使用模拟行情（无需账户，适合开发调试）：
    python market_server.py --sim

说明：
  - 默认端口 8765，监听 localhost
  - 支持多个 Electron 客户端同时连接
  - 通过 WebSocket 推送 K 线（1分钟）和 Tick 行情
"""

import asyncio
import json
import logging
import time
import argparse
from datetime import datetime
from typing import Set, Dict, Optional

import websockets
from websockets.server import WebSocketServerProtocol
from tqsdk import TqApi, TqAuth, TqSim, TqReplay
from tqsdk.objs import Quote, Kline

# ─── 日志配置 ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger('FuturLens')

# ─── 全局状态 ──────────────────────────────────────────────────────────────────
connected_clients: Set[WebSocketServerProtocol] = set()
# 各客户端订阅的品种
client_subscriptions: Dict[WebSocketServerProtocol, str] = {}


# ─── 工具函数 ──────────────────────────────────────────────────────────────────
def kline_to_dict(kline: Kline, timestamp: int) -> dict:
    """将 TqSdk K 线对象转换为标准字典"""
    return {
        'time': timestamp,
        'open': float(kline['open']),
        'high': float(kline['high']),
        'low': float(kline['low']),
        'close': float(kline['close']),
        'volume': int(kline['volume']),
    }


def quote_to_tick(quote: Quote, ts: float) -> dict:
    """将 TqSdk 行情对象转换为 Tick 字典"""
    return {
        'time': int(ts),
        'price': float(quote.last_price),
        'volume': int(quote.volume),
        'bid': float(quote.bid_price1),
        'ask': float(quote.ask_price1),
        'open_interest': int(quote.open_interest),
    }


async def broadcast(message: dict, target_symbol: Optional[str] = None) -> None:
    """广播消息到所有连接的客户端（或订阅了特定品种的客户端）"""
    if not connected_clients:
        return

    data = json.dumps(message, ensure_ascii=False)
    targets = set()

    for client in connected_clients:
        sub = client_subscriptions.get(client)
        if target_symbol is None or sub == target_symbol:
            targets.add(client)

    if targets:
        await asyncio.gather(
            *[client.send(data) for client in targets],
            return_exceptions=True
        )


# ─── 行情推送任务（每个品种一个协程）─────────────────────────────────────────
class MarketDataTask:
    """
    负责订阅一个期货品种的行情并推送到 WebSocket 客户端
    """

    def __init__(self, api: TqApi, symbol: str):
        self.api = api
        self.symbol = symbol
        self._running = False

    async def run(self) -> None:
        self._running = True
        logger.info(f'开始订阅 {self.symbol} 行情...')

        try:
            # 订阅 1 分钟 K 线（最近 200 根）
            klines = self.api.get_kline_serial(self.symbol, 60, data_length=200)
            # 订阅实时 Tick 行情
            quote = self.api.get_quote(self.symbol)

            # 等待数据就绪
            await self.api.wait_update()

            # 发送历史 K 线
            history = []
            for i in range(len(klines)):
                row = klines.iloc[i]
                ts = int(row['datetime'] / 1_000_000_000)  # 纳秒转秒
                if ts > 0:
                    history.append(kline_to_dict(row, ts))

            await broadcast(
                {'type': 'history', 'symbol': self.symbol, 'data': history},
                target_symbol=self.symbol
            )
            logger.info(f'{self.symbol} 历史数据推送完成，共 {len(history)} 根 K 线')

            # 实时推送循环
            last_kline_ts = 0
            last_tick_time = 0

            while self._running:
                await self.api.wait_update()

                now = time.time()

                # ── 推送实时 K 线 ──
                if self.api.is_changing(klines):
                    latest = klines.iloc[-1]
                    ts = int(latest['datetime'] / 1_000_000_000)
                    if ts > 0 and ts != last_kline_ts:
                        last_kline_ts = ts
                        await broadcast(
                            {
                                'type': 'candle',
                                'symbol': self.symbol,
                                'data': kline_to_dict(latest, ts)
                            },
                            target_symbol=self.symbol
                        )

                # ── 推送 Tick（限频：最高 5 次/秒）──
                if self.api.is_changing(quote) and (now - last_tick_time) >= 0.2:
                    last_tick_time = now
                    if quote.last_price and quote.last_price == quote.last_price:  # 非 NaN
                        await broadcast(
                            {
                                'type': 'tick',
                                'symbol': self.symbol,
                                'data': quote_to_tick(quote, now)
                            },
                            target_symbol=self.symbol
                        )

        except Exception as e:
            logger.error(f'{self.symbol} 行情任务异常: {e}', exc_info=True)
            await broadcast(
                {'type': 'error', 'message': f'行情订阅异常: {str(e)}'},
                target_symbol=self.symbol
            )

    def stop(self) -> None:
        self._running = False


# ─── WebSocket 连接处理 ────────────────────────────────────────────────────────
class MarketServer:

    def __init__(self, api: TqApi):
        self.api = api
        self.tasks: Dict[str, MarketDataTask] = {}

    async def handle_client(self, websocket: WebSocketServerProtocol) -> None:
        """处理单个客户端连接"""
        connected_clients.add(websocket)
        client_addr = websocket.remote_address
        logger.info(f'客户端连接: {client_addr}，当前连接数: {len(connected_clients)}')

        try:
            async for raw_message in websocket:
                try:
                    msg = json.loads(raw_message)
                    await self._handle_message(websocket, msg)
                except json.JSONDecodeError:
                    logger.warning(f'无效消息: {raw_message}')
                except Exception as e:
                    logger.error(f'消息处理异常: {e}')

        except websockets.exceptions.ConnectionClosed:
            logger.info(f'客户端断开: {client_addr}')
        finally:
            connected_clients.discard(websocket)
            client_subscriptions.pop(websocket, None)
            logger.info(f'剩余连接数: {len(connected_clients)}')

    async def _handle_message(
        self,
        websocket: WebSocketServerProtocol,
        msg: dict
    ) -> None:
        """处理客户端消息"""
        msg_type = msg.get('type')

        if msg_type == 'subscribe':
            symbol = msg.get('symbol', 'rb2505')
            # 标准化品种代码（天勤格式：SHFE.rb2505）
            full_symbol = self._normalize_symbol(symbol)
            client_subscriptions[websocket] = full_symbol

            logger.info(f'客户端订阅品种: {full_symbol}')

            # 如果该品种还没有运行中的任务，启动之
            if full_symbol not in self.tasks:
                task = MarketDataTask(self.api, full_symbol)
                self.tasks[full_symbol] = task
                # 在后台运行行情任务
                asyncio.create_task(task.run())
            else:
                # 品种已在运行，发送一条确认消息
                await websocket.send(json.dumps({
                    'type': 'subscribed',
                    'symbol': full_symbol,
                    'message': '已订阅，等待实时数据...'
                }))

        elif msg_type == 'ping':
            await websocket.send(json.dumps({'type': 'pong', 'ts': time.time()}))

        elif msg_type == 'unsubscribe':
            client_subscriptions.pop(websocket, None)

        else:
            logger.warning(f'未知消息类型: {msg_type}')

    @staticmethod
    def _normalize_symbol(symbol: str) -> str:
        """
        将简短品种代码转换为天勤标准格式
        示例：'rb2505' → 'SHFE.rb2505'
                'IF2505' → 'CFFEX.IF2505'
                'm2505'  → 'DCE.m2505'
        """
        if '.' in symbol:
            return symbol  # 已经是完整格式

        symbol_lower = symbol.lower()

        # 上期所（SHFE）
        shfe_products = ['rb', 'hc', 'au', 'ag', 'cu', 'al', 'zn', 'pb',
                         'ni', 'sn', 'ss', 'fu', 'ru', 'bu', 'sp', 'nr']
        # 大商所（DCE）
        dce_products = ['m', 'a', 'b', 'c', 'cs', 'jd', 'lh', 'bb', 'fb',
                        'p', 'y', 'l', 'v', 'pp', 'j', 'jm', 'i', 'eg',
                        'eb', 'rr', 'pg']
        # 郑商所（CZCE）
        czce_products = ['cf', 'sr', 'ta', 'ma', 'rm', 'oi', 'rs', 'wh',
                         'pm', 'ri', 'jr', 'lr', 'cy', 'ap', 'cj', 'pk',
                         'ur', 'sa', 'pf', 'wr', 'sm', 'sf']
        # 中金所（CFFEX）
        cffex_products = ['if', 'ic', 'ih', 'im', 'tf', 'ts', 'tl', 'tff']
        # 上期能源（INE）
        ine_products = ['sc', 'lu', 'bc', 'nr']

        # 提取字母前缀
        prefix = ''.join(filter(str.isalpha, symbol_lower))

        if prefix in shfe_products:
            return f'SHFE.{symbol}'
        elif prefix in dce_products:
            return f'DCE.{symbol}'
        elif prefix in czce_products:
            # 郑商所品种代码大写
            return f'CZCE.{symbol.upper()}'
        elif prefix in cffex_products:
            return f'CFFEX.{symbol.upper()}'
        elif prefix in ine_products:
            return f'INE.{symbol}'
        else:
            # 默认尝试上期所
            logger.warning(f'无法识别品种交易所: {symbol}，默认使用 SHFE')
            return f'SHFE.{symbol}'


# ─── 主入口 ────────────────────────────────────────────────────────────────────
async def main(args: argparse.Namespace) -> None:
    logger.info('FuturLens 行情服务器启动中...')

    # 创建 TqSdk API 实例
    if args.sim or (not args.account):
        # 模拟模式（不需要账户，适合开发调试）
        logger.info('使用模拟行情模式（TqSim）')
        api = TqApi(TqSim(), web_gui=False)
    else:
        # 实盘模式
        logger.info(f'使用实盘行情，账户: {args.account}')
        api = TqApi(
            auth=TqAuth(args.account, args.password),
            web_gui=False
        )

    server = MarketServer(api)

    host = '127.0.0.1'
    port = args.port

    async with websockets.serve(
        server.handle_client,
        host,
        port,
        ping_interval=20,
        ping_timeout=10,
        max_size=10 * 1024 * 1024  # 10MB（历史数据可能较大）
    ):
        logger.info(f'WebSocket 服务器已启动: ws://{host}:{port}')
        logger.info('等待 Electron 客户端连接...')
        logger.info('按 Ctrl+C 停止服务器')

        try:
            await asyncio.Future()  # 永久运行
        except asyncio.CancelledError:
            logger.info('服务器正在关闭...')
        finally:
            api.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FuturLens 期货行情 WebSocket 服务器')
    parser.add_argument('--account', type=str, help='天勤账号', default='')
    parser.add_argument('--password', type=str, help='天勤密码', default='')
    parser.add_argument('--port', type=int, default=8765, help='WebSocket 端口（默认 8765）')
    parser.add_argument('--sim', action='store_true', help='使用模拟行情（无需账户）')
    args = parser.parse_args()

    try:
        asyncio.run(main(args))
    except KeyboardInterrupt:
        logger.info('服务器已停止')
