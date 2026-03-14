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

// ─── K 线图 + 趋势线绘制组件 ──────────────────────────────────────────────────
export default function Chart() {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const trendLineSeriesRefs = useRef<Map<string, ISeriesApi<'Line'>>>(new Map())

  // 趋势线绘制状态
  const [isDrawing, setIsDrawing] = useState(false)
  const drawStartRef = useRef<{ time: number; price: number } | null>(null)

  const { candles, mode, trendLines, addTrendLine, removeTrendLine } = useAppStore()

  // ─── 初始化图表 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,

      // 透明背景（关键）
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255, 255, 255, 0.7)',
        fontSize: 11,
        fontFamily: 'JetBrains Mono, Consolas, monospace'
      },

      // 网格线（半透明）
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.06)', style: 1 },
        horzLines: { color: 'rgba(255, 255, 255, 0.06)', style: 1 }
      },

      // 价格轴
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.15)',
        textColor: 'rgba(255, 255, 255, 0.6)',
        scaleMargins: { top: 0.08, bottom: 0.08 }
      },

      // 时间轴
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.15)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          const date = new Date(time * 1000)
          return `${date.getHours().toString().padStart(2, '0')}:${date
            .getMinutes()
            .toString()
            .padStart(2, '0')}`
        }
      },

      // 十字线
      crosshair: {
        vertLine: {
          color: 'rgba(255, 255, 255, 0.3)',
          width: 1,
          style: 1,
          labelBackgroundColor: 'rgba(30, 40, 55, 0.9)'
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.3)',
          width: 1,
          style: 1,
          labelBackgroundColor: 'rgba(30, 40, 55, 0.9)'
        }
      },

      // 无滚动条
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true }
    })

    // 蜡烛图系列
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350'
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries

    // 窗口 resize 自适应
    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.resize(
          containerRef.current.clientWidth,
          containerRef.current.clientHeight
        )
      }
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      candleSeriesRef.current = null
    }
  }, [])

  // ─── 同步 K 线数据到图表 ─────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || candles.length === 0) return

    const chartData: CandlestickData[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))

    candleSeriesRef.current.setData(chartData)
    // 滚动到最新
    chartRef.current?.timeScale().scrollToRealTime()
  }, [candles])

  // ─── 同步趋势线到图表 ────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return

    const existingIds = new Set(trendLineSeriesRefs.current.keys())
    const currentIds = new Set(trendLines.map((l) => l.id))

    // 删除已移除的趋势线系列
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        const series = trendLineSeriesRefs.current.get(id)
        if (series) chartRef.current.removeSeries(series)
        trendLineSeriesRefs.current.delete(id)
      }
    }

    // 添加新趋势线
    for (const line of trendLines) {
      if (!existingIds.has(line.id)) {
        const series = chartRef.current.addLineSeries({
          color: line.color,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false
        })

        const lineData: LineData[] = [
          { time: line.startTime as Time, value: line.startPrice },
          { time: line.endTime as Time, value: line.endPrice }
        ]
        series.setData(lineData)
        trendLineSeriesRefs.current.set(line.id, series)
      }
    }
  }, [trendLines])

  // ─── 趋势线绘制交互 ──────────────────────────────────────────────────────
  const handleChartClick = useCallback(
    (params: MouseEventParams) => {
      if (mode !== 'draw' || !params.time || !params.seriesData) return

      // 获取点击位置的价格（从 K 线系列获取）
      const candleData = params.seriesData.get(candleSeriesRef.current!)
      if (!candleData) return
      const price = (candleData as CandlestickData).close
      const time = params.time as number

      if (!isDrawing || !drawStartRef.current) {
        // 第一次点击：设置起点
        drawStartRef.current = { time, price }
        setIsDrawing(true)
      } else {
        // 第二次点击：完成趋势线
        const { time: startTime, price: startPrice } = drawStartRef.current
        const newLine: TrendLine = {
          id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          startTime,
          startPrice,
          endTime: time,
          endPrice: price,
          color: '#f59e0b'  // 金色
        }
        addTrendLine(newLine)
        drawStartRef.current = null
        setIsDrawing(false)
      }
    },
    [mode, isDrawing, addTrendLine]
  )

  // 注册图表点击事件
  useEffect(() => {
    if (!chartRef.current) return
    chartRef.current.subscribeClick(handleChartClick)
    return () => {
      chartRef.current?.unsubscribeClick(handleChartClick)
    }
  }, [handleChartClick])

  // 取消绘制（右键）
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (isDrawing) {
        drawStartRef.current = null
        setIsDrawing(false)
      }
    },
    [isDrawing]
  )

  // 双击删除最近的趋势线
  const handleDoubleClick = useCallback(() => {
    if (mode === 'draw' && trendLines.length > 0) {
      removeTrendLine(trendLines[trendLines.length - 1].id)
    }
  }, [mode, trendLines, removeTrendLine])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        cursor: mode === 'draw'
          ? isDrawing
            ? 'crosshair'
            : 'cell'
          : 'none'   // 观察模式鼠标隐藏（穿透时不展示）
      }}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    />
  )
}
