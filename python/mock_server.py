"""
FuturLens 模拟行情服务器（无需 TqSdk，用于纯 UI 开发调试）
=============================================================
在没有天勤账号时，可先用此脚本验证前端连接和图表渲染是否正常。

运行：
    python mock_server.py
"""

import asyncio
import json
import time
import math
import random
import logging
from typing import Set

import websockets
from websockets.server import WebSocketServerProtocol

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('MockServer')

connected_clients: Set[WebSocketServerProtocol] = set()

# ─── 模拟 K 线生成器 ──────────────────────────────────────────────────────────
class MockMarket:
    """生成随机游走的模拟期货行情"""

    def __init__(self, base_price: float = 3500.0, symbol: str = 'SHFE.rb2505'):
        self.symbol = symbol
        self.price = base_price
        self.ts = int(time.time()) - 200 * 60  # 从 200 分钟前开始

    def next_candle(self) -> dict:
        """生成下一根 1 分钟 K 线"""
        # 随机游走
        change = random.gauss(0, 8)
        self.price = max(2000, min(5000, self.price + change))

        open_p = self.price
        close_p = self.price + random.gauss(0, 5)
        high_p = max(open_p, close_p) + abs(random.gauss(0, 3))
        low_p = min(open_p, close_p) - abs(random.gauss(0, 3))
        volume = random.randint(100, 2000)

        self.ts += 60
        self.price = close_p

        return {
            'time': self.ts,
            'open': round(open_p, 1),
            'high': round(high_p, 1),
            'low': round(low_p, 1),
            'close': round(close_p, 1),
            'volume': volume
        }

    def current_tick(self) -> dict:
        """生成当前 Tick"""
        tick_price = self.price + random.gauss(0, 1)
        return {
            'time': int(time.time()),
            'price': round(tick_price, 1),
            'volume': random.randint(1, 50)
        }


# ─── WebSocket 服务 ───────────────────────────────────────────────────────────
market = MockMarket()

async def handle_client(websocket: WebSocketServerProtocol) -> None:
    connected_clients.add(websocket)
    logger.info(f'客户端连接，共 {len(connected_clients)} 个')

    try:
        async for raw in websocket:
            msg = json.loads(raw)

            if msg.get('type') == 'subscribe':
                # 发送历史 200 根 K 线
                m = MockMarket()
                history = [m.next_candle() for _ in range(200)]
                await websocket.send(json.dumps({
                    'type': 'history',
                    'symbol': msg.get('symbol', 'SHFE.rb2505'),
                    'data': history
                }))
                logger.info('已推送历史 K 线')

            elif msg.get('type') == 'ping':
                await websocket.send(json.dumps({'type': 'pong'}))

    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)


async def push_realtime() -> None:
    """每分钟推送新 K 线，每秒推送 Tick"""
    last_candle_time = int(time.time() // 60) * 60

    while True:
        await asyncio.sleep(1)

        now = int(time.time() // 60) * 60
        # 新的一分钟，推送 K 线
        if now > last_candle_time:
            last_candle_time = now
            candle = market.next_candle()
            if connected_clients:
                data = json.dumps({'type': 'candle', 'data': candle})
                await asyncio.gather(*[c.send(data) for c in connected_clients], return_exceptions=True)

        # 每秒推送 Tick
        if connected_clients:
            tick = market.current_tick()
            data = json.dumps({'type': 'tick', 'data': tick})
            await asyncio.gather(*[c.send(data) for c in connected_clients], return_exceptions=True)


async def main() -> None:
    logger.info('模拟行情服务器启动: ws://127.0.0.1:8765')

    async with websockets.serve(handle_client, '127.0.0.1', 8765):
        await asyncio.gather(
            asyncio.Future(),   # 永久运行
            push_realtime()
        )


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info('服务器已停止')
