import { useEffect, useRef, useCallback } from 'react'
import { useAppStore, Candle, Tick } from '../store/appStore'

// Python 行情服务器地址
const WS_URL = 'ws://localhost:8765'
const RECONNECT_DELAY = 3000  // 3秒重连

// ─── WebSocket 消息类型 ───────────────────────────────────────────────────────
interface WsMessage {
  type: 'candle' | 'tick' | 'history' | 'error' | 'pong'
  data?: Candle | Tick | Candle[]
  message?: string
}

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const isUnmountedRef = useRef(false)

  const { setWsConnected, updateLatestCandle, setCandles, setLatestTick, symbol } = useAppStore()

  const connect = useCallback(() => {
    if (isUnmountedRef.current) return

    try {
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        console.log(`[WS] 连接成功  readyState=${ws.readyState}`)  // 1 = OPEN
        setWsConnected(true)

        // 订阅指定品种行情
        ws.send(JSON.stringify({
          type: 'subscribe',
          symbol,
          kline_period: '1m'
        }))
      }

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: WsMessage = JSON.parse(event.data as string)

          switch (msg.type) {
            case 'history':
              // 历史 K 线数据（初始化）
              setCandles(msg.data as Candle[])
              break

            case 'candle':
              // 实时 K 线更新（最新一根）
              updateLatestCandle(msg.data as Candle)
              break

            case 'tick':
              // 实时 Tick 价格
              setLatestTick(msg.data as Tick)
              break

            case 'error':
              console.error('[WS] 服务器错误:', msg.message)
              break
          }
        } catch (e) {
          console.error('[WS] 消息解析失败:', e)
        }
      }

      ws.onerror = (err) => {
        console.error(`[WS] 连接错误  readyState=${ws.readyState}`, err)
        // readyState: 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED
        // 若 mock_server.py 未启动，readyState 会是 3
      }

      ws.onclose = (ev) => {
        console.log(`[WS] 连接断开  code=${ev.code} reason="${ev.reason}"，${RECONNECT_DELAY/1000}s 后重连...`)
        setWsConnected(false)
        wsRef.current = null

        if (!isUnmountedRef.current) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY)
        }
      }
    } catch (e) {
      console.error('[WS] 创建连接失败:', e)
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY)
    }
  }, [symbol, setWsConnected, updateLatestCandle, setCandles, setLatestTick])

  useEffect(() => {
    isUnmountedRef.current = false
    connect()

    return () => {
      isUnmountedRef.current = true
      clearTimeout(reconnectTimerRef.current)
      wsRef.current?.close()
    }
  }, [connect])
}
