import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  LineData,
  Time,
  MouseEventParams,
  ColorType
} from 'lightweight-charts'
import { useAppStore, TrendLine } from '../store/appStore'

// ─── 初始占位数据：启动即渲染，不等 WebSocket ────────────────────────────────
function generatePlaceholderCandles(): CandlestickData[] {
  const now = Math.floor(Date.now() / 1000)
  const candles: CandlestickData[] = []
  let price = 3500
  for (let i = 59; i >= 0; i--) {
    const t = now - i * 60
    const change = (Math.random() - 0.5) * 20
    const open  = price
    const close = price + change
    const high  = Math.max(open, close) + Math.random() * 8
    const low   = Math.min(open, close) - Math.random() * 8
    price = close
    candles.push({
      time:  t as Time,
      open:  parseFloat(open.toFixed(1)),
      high:  parseFloat(high.toFixed(1)),
      low:   parseFloat(low.toFixed(1)),
      close: parseFloat(close.toFixed(1)),
    })
  }
  return candles
}

// ─── K 线图 + 趋势线绘制 ──────────────────────────────────────────────────────
export default function Chart() {
  const containerRef   = useRef<HTMLDivElement>(null)
  const chartRef       = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const trendLineSeriesRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())
  const hasRealDataRef = useRef(false)   // 是否已收到真实 WS 数据

  const [isDrawing, setIsDrawing] = useState(false)
  const drawStartRef = useRef<{ time: number; price: number } | null>(null)

  const { candles, mode, trendLines, addTrendLine, removeTrendLine } = useAppStore()

  // ─── 初始化图表 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      // 自动填满容器（不依赖初始化时的 clientWidth/clientHeight）
      autoSize: true,

      layout: {
        // 修复：'transparent' CSS 关键字在部分版本中不被解析
        // rgba(0,0,0,0) 是等效的完全透明色，canvas 级别生效
        background: { type: ColorType.Solid, color: 'rgba(0, 0, 0, 0)' },
        textColor:  'rgba(220, 220, 220, 0.85)',
        fontSize:   11,
        fontFamily: 'Consolas, monospace',
      },

      grid: {
        // 提高网格线对比度（透明背景下更容易看到图表已渲染）
        vertLines: { color: 'rgba(255, 255, 255, 0.12)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.12)' },
      },

      rightPriceScale: {
        borderColor:   'rgba(255, 255, 255, 0.2)',
        textColor:     'rgba(220, 220, 220, 0.85)',
        scaleMargins:  { top: 0.08, bottom: 0.08 },
      },

      timeScale: {
        borderColor:      'rgba(255, 255, 255, 0.2)',
        timeVisible:      true,
        secondsVisible:   false,
      },

      crosshair: {
        vertLine: { color: 'rgba(255, 255, 255, 0.5)', labelBackgroundColor: 'rgba(30,40,55,0.95)' },
        horzLine: { color: 'rgba(255, 255, 255, 0.5)', labelBackgroundColor: 'rgba(30,40,55,0.95)' },
      },

      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale:  { mouseWheel: true, pinch: true },
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor:        '#26a69a',
      downColor:      '#ef5350',
      borderUpColor:  '#26a69a',
      borderDownColor:'#ef5350',
      wickUpColor:    '#26a69a',
      wickDownColor:  '#ef5350',
    })

    // ── 立即渲染占位数据，不等 WebSocket ──
    const placeholder = generatePlaceholderCandles()
    candleSeries.setData(placeholder)
    // fitContent 确保所有数据可见，不依赖时间轴对齐当前时刻
    chart.timeScale().fitContent()
    console.log('[Chart] 占位 K 线已渲染，共', placeholder.length, '根')

    chartRef.current      = chart
    candleSeriesRef.current = candleSeries

    return () => {
      chart.remove()
      chartRef.current       = null
      candleSeriesRef.current = null
      hasRealDataRef.current  = false
    }
  }, [])

  // ─── 同步真实行情数据到图表 ────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return

    const chartData: CandlestickData[] = candles.map((c) => ({
      time:  c.time as Time,
      open:  c.open,
      high:  c.high,
      low:   c.low,
      close: c.close,
    }))

    candleSeriesRef.current.setData(chartData)

    // 首次收到真实数据时适配视口；后续实时更新时保持当前视角
    if (!hasRealDataRef.current) {
      hasRealDataRef.current = true
      chartRef.current?.timeScale().fitContent()
      console.log('[Chart] 真实行情已渲染，共', chartData.length, '根 K 线')
    } else {
      // 若用户没有手动拖动，保持跟随最新价格
      chartRef.current?.timeScale().scrollToRealTime()
    }
  }, [candles])

  // ─── 同步趋势线 ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return

    const existingIds = new Set(trendLineSeriesRefs.current.keys())
    const currentIds  = new Set(trendLines.map((l) => l.id))

    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const s = trendLineSeriesRefs.current.get(id)
        if (s) chartRef.current.removeSeries(s)
        trendLineSeriesRefs.current.delete(id)
      }
    }

    for (const line of trendLines) {
      if (!existingIds.has(line.id)) {
        const s = chartRef.current.addLineSeries({
          color:                  line.color,
          lineWidth:              2,
          priceLineVisible:       false,
          lastValueVisible:       false,
          crosshairMarkerVisible: false,
        })
        s.setData([
          { time: line.startTime as Time, value: line.startPrice },
          { time: line.endTime   as Time, value: line.endPrice   },
        ] as LineData[])
        trendLineSeriesRefs.current.set(line.id, s)
      }
    }
  }, [trendLines])

  // ─── 趋势线点击绘制 ────────────────────────────────────────────────────────
  const handleChartClick = useCallback(
    (params: MouseEventParams) => {
      if (mode !== 'draw' || !params.time || !params.seriesData) return
      const candleData = params.seriesData.get(candleSeriesRef.current!)
      if (!candleData) return
      const price = (candleData as CandlestickData).close
      const time  = params.time as number

      if (!drawStartRef.current) {
        drawStartRef.current = { time, price }
        setIsDrawing(true)
      } else {
        addTrendLine({
          id:         `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          startTime:  drawStartRef.current.time,
          startPrice: drawStartRef.current.price,
          endTime:    time,
          endPrice:   price,
          color:      '#f59e0b',
        })
        drawStartRef.current = null
        setIsDrawing(false)
      }
    },
    [mode, addTrendLine]
  )

  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.subscribeClick(handleChartClick)
    return () => { chartRef.current?.unsubscribeClick(handleChartClick) }
  }, [handleChartClick])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    if (isDrawing) { drawStartRef.current = null; setIsDrawing(false) }
  }, [isDrawing])

  const handleDoubleClick = useCallback(() => {
    if (mode === 'draw' && trendLines.length > 0)
      removeTrendLine(trendLines[trendLines.length - 1].id)
  }, [mode, trendLines, removeTrendLine])

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: 0, left: 0,
        width:  '100vw',
        height: '100vh',
        cursor: mode === 'draw' ? (isDrawing ? 'crosshair' : 'cell') : 'default',
      }}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    />
  )
}
