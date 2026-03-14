import { create } from 'zustand'

// ─── 行情数据类型 ─────────────────────────────────────────────────────────────
export interface Candle {
  time: number      // Unix 时间戳（秒）
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Tick {
  time: number
  price: number
  volume: number
}

// ─── 趋势线类型 ───────────────────────────────────────────────────────────────
export interface TrendLine {
  id: string
  startTime: number
  startPrice: number
  endTime: number
  endPrice: number
  color: string
}

// ─── 价格对齐配置 ─────────────────────────────────────────────────────────────
export interface PriceAlignConfig {
  // 文华财经 K 线的价格区间（手动输入）
  wenhuaMinPrice: number
  wenhuaMaxPrice: number
  // 浮层窗口在屏幕上的像素区间（对应价格区间）
  pixelTop: number      // 最高价对应的屏幕像素 y
  pixelBottom: number   // 最低价对应的屏幕像素 y
}

// ─── 应用状态 ─────────────────────────────────────────────────────────────────
interface AppState {
  // 交互模式
  mode: 'observe' | 'draw'
  setMode: (mode: 'observe' | 'draw') => void

  // 当前品种
  symbol: string
  setSymbol: (symbol: string) => void

  // 行情数据
  candles: Candle[]
  latestTick: Tick | null
  appendCandle: (candle: Candle) => void
  updateLatestCandle: (candle: Candle) => void
  setCandles: (candles: Candle[]) => void
  setLatestTick: (tick: Tick) => void

  // 趋势线
  trendLines: TrendLine[]
  addTrendLine: (line: TrendLine) => void
  removeTrendLine: (id: string) => void
  clearTrendLines: () => void

  // 连接状态
  wsConnected: boolean
  setWsConnected: (connected: boolean) => void

  // 价格对齐
  priceAlign: PriceAlignConfig
  setPriceAlign: (config: Partial<PriceAlignConfig>) => void

  // 窗口透明度
  opacity: number
  setOpacity: (opacity: number) => void
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'observe',
  setMode: (mode) => set({ mode }),

  symbol: 'rb2505',
  setSymbol: (symbol) => set({ symbol }),

  candles: [],
  latestTick: null,
  appendCandle: (candle) =>
    set((state) => ({ candles: [...state.candles, candle] })),
  updateLatestCandle: (candle) =>
    set((state) => {
      const candles = [...state.candles]
      if (candles.length > 0 && candles[candles.length - 1].time === candle.time) {
        candles[candles.length - 1] = candle
      } else {
        candles.push(candle)
      }
      return { candles }
    }),
  setCandles: (candles) => set({ candles }),
  setLatestTick: (tick) => set({ latestTick: tick }),

  trendLines: [],
  addTrendLine: (line) =>
    set((state) => ({ trendLines: [...state.trendLines, line] })),
  removeTrendLine: (id) =>
    set((state) => ({ trendLines: state.trendLines.filter((l) => l.id !== id) })),
  clearTrendLines: () => set({ trendLines: [] }),

  wsConnected: false,
  setWsConnected: (connected) => set({ wsConnected: connected }),

  priceAlign: {
    wenhuaMinPrice: 3000,
    wenhuaMaxPrice: 4000,
    pixelTop: 50,
    pixelBottom: 600
  },
  setPriceAlign: (config) =>
    set((state) => ({ priceAlign: { ...state.priceAlign, ...config } })),

  opacity: 0.85,
  setOpacity: (opacity) => set({ opacity })
}))
