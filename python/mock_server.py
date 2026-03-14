"""
FuturLens 模拟行情服务器（无需 TqSdk，用于纯 UI 开发调试）
=============================================================
修复：使用统一的 SharedMarket，保证历史 K 线和实时 K 线时间戳连续对齐。

运行：
    python mock_server.py
"""

import asyncio
import json
import time
import random
import logging
from typing import List, Set

import websockets
from websockets.server import WebSocketServerProtocol

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('MockServer')

connected_clients: Set[WebSocketServerProtocol] = set()


# ─── 统一行情状态（全局单例）─────────────────────────────────────────────────
class SharedMarket:
    """
    维护一份连续的 K 线历史，保证历史和实时时间戳对齐。
    规则：每根 K 线的 time = 该分钟的起始 Unix 秒（向下取整到分钟）
    """

    HISTORY_COUNT = 200  # 初始历史根数

    def __init__(self, base_price: float = 3500.0):
        self.price  = base_price
        self.candles: List[dict] = []
        self._build_history()

    def _make_candle(self, ts: int) -> dict:
        """生成一根 K 线，价格随机游走"""
        change   = random.gauss(0, 10)
        self.price = max(2500, min(5000, self.price + change))
        open_p   = round(self.price, 1)
        close_p  = round(self.price + random.gauss(0, 6), 1)
        high_p   = round(max(open_p, close_p) + abs(random.gauss(0, 4)), 1)
        low_p    = round(min(open_p, close_p) - abs(random.gauss(0, 4)), 1)
        self.price = close_p
        return {
            'time':   ts,
            'open':   open_p,
            'high':   high_p,
            'low':    low_p,
            'close':  close_p,
            'volume': random.randint(200, 3000),
        }

    def _build_history(self) -> None:
        """在启动时生成 HISTORY_COUNT 根历史 K 线，最后一根的 time = 上一整分钟"""
        now_min = (int(time.time()) // 60) * 60   # 当前整分钟
        start   = now_min - self.HISTORY_COUNT * 60
        for i in range(self.HISTORY_COUNT):
            ts = start + i * 60
            self.candles.append(self._make_candle(ts))
        logger.info(f'历史 K 线已生成  {self.HISTORY_COUNT} 根  '
                    f'{self.candles[0]["time"]} → {self.candles[-1]["time"]}')

    def get_history(self) -> List[dict]:
        return list(self.candles)

    def advance_minute(self) -> dict:
        """进入新的一分钟：追加一根新 K 线并返回它"""
        last_ts = self.candles[-1]['time'] if self.candles else 0
        new_ts  = last_ts + 60
        candle  = self._make_candle(new_ts)
        self.candles.append(candle)
        # 只保留最近 500 根
        if len(self.candles) > 500:
            self.candles = self.candles[-500:]
        return candle

    def current_tick(self) -> dict:
        """生成当前 Tick（价格在最新收盘价附近微动）"""
        last_close = self.candles[-1]['close'] if self.candles else self.price
        return {
            'time':   int(time.time()),
            'price':  round(last_close + random.gauss(0, 1.5), 1),
            'volume': random.randint(1, 80),
        }


# 全局单例
market = SharedMarket()


# ─── WebSocket 连接处理 ────────────────────────────────────────────────────────
async def handle_client(websocket: WebSocketServerProtocol) -> None:
    connected_clients.add(websocket)
    logger.info(f'客户端连接  共 {len(connected_clients)} 个')

    try:
        async for raw in websocket:
            msg = json.loads(raw)

            if msg.get('type') == 'subscribe':
                symbol  = msg.get('symbol', 'SHFE.rb2505')
                history = market.get_history()
                await websocket.send(json.dumps({
                    'type':   'history',
                    'symbol': symbol,
                    'data':   history,
                }))
                logger.info(f'已推送 {len(history)} 根历史 K 线  → {websocket.remote_address}')

            elif msg.get('type') == 'ping':
                await websocket.send(json.dumps({'type': 'pong', 'ts': time.time()}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        logger.info(f'客户端断开  剩余 {len(connected_clients)} 个')


# ─── 实时推送循环 ─────────────────────────────────────────────────────────────
async def push_realtime() -> None:
    """
    每分钟准点（:00 秒）推送新 K 线；每秒推送 Tick。
    K 线时间戳 = 当前整分钟，与历史数据严格连续。
    """
    # 等到下一个整分钟
    now = time.time()
    wait = 60 - (now % 60)
    logger.info(f'等待 {wait:.1f}s 到下一整分钟后开始推 K 线...')
    await asyncio.sleep(wait)

    while True:
        loop_start = time.time()

        # ── 推送新 K 线 ──
        candle = market.advance_minute()
        if connected_clients:
            data = json.dumps({'type': 'candle', 'data': candle})
            await asyncio.gather(
                *[c.send(data) for c in set(connected_clients)],
                return_exceptions=True
            )
            logger.info(f'K 线推送  time={candle["time"]}  close={candle["close"]}')

        # ── 每秒推 Tick，持续到下一分钟 ──
        for _ in range(59):
            await asyncio.sleep(1)
            if connected_clients:
                tick = market.current_tick()
                data = json.dumps({'type': 'tick', 'data': tick})
                await asyncio.gather(
                    *[c.send(data) for c in set(connected_clients)],
                    return_exceptions=True
                )

        # 精确等待到下一整分钟（补偿处理时间）
        elapsed = time.time() - loop_start
        await asyncio.sleep(max(0, 60 - elapsed))


# ─── 主入口 ───────────────────────────────────────────────────────────────────
async def main() -> None:
    logger.info('模拟行情服务器启动: ws://127.0.0.1:8765')
    logger.info(f'初始历史 {SharedMarket.HISTORY_COUNT} 根 K 线已就绪')

    async with websockets.serve(handle_client, '127.0.0.1', 8765):
        await asyncio.gather(
            asyncio.Future(),
            push_realtime(),
        )


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info('服务器已停止')
