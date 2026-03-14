import { useCallback } from 'react'
import { useAppStore } from '../store/appStore'

// ─── 价格对齐算法 ─────────────────────────────────────────────────────────────
//
// 核心思路：
//   已知文华财经图表显示的价格区间 [wenhuaMin, wenhuaMax]
//   以及浮层窗口中对应区间的屏幕像素 [pixelTop（高价）, pixelBottom（低价）]
//
//   价格 → 像素：pixel = pixelTop + (wenhuaMax - price) / priceRange * pixelHeight
//   像素 → 价格：price = wenhuaMax - (pixel - pixelTop) / pixelHeight * priceRange
//
export function usePriceAlign() {
  const { priceAlign, setPriceAlign } = useAppStore()

  // 将价格转换为浮层内的像素 y 坐标
  const priceToPixel = useCallback(
    (price: number): number => {
      const { wenhuaMinPrice, wenhuaMaxPrice, pixelTop, pixelBottom } = priceAlign
      const priceRange = wenhuaMaxPrice - wenhuaMinPrice
      const pixelHeight = pixelBottom - pixelTop
      if (priceRange === 0) return pixelTop
      return pixelTop + ((wenhuaMaxPrice - price) / priceRange) * pixelHeight
    },
    [priceAlign]
  )

  // 将浮层像素 y 坐标转换为价格
  const pixelToPrice = useCallback(
    (pixel: number): number => {
      const { wenhuaMinPrice, wenhuaMaxPrice, pixelTop, pixelBottom } = priceAlign
      const priceRange = wenhuaMaxPrice - wenhuaMinPrice
      const pixelHeight = pixelBottom - pixelTop
      if (pixelHeight === 0) return wenhuaMaxPrice
      return wenhuaMaxPrice - ((pixel - pixelTop) / pixelHeight) * priceRange
    },
    [priceAlign]
  )

  // 自动对齐：根据当前 K 线数据的最高最低价自动计算对齐参数
  const autoAlign = useCallback(
    (visibleCandles: { high: number; low: number }[], chartHeight: number) => {
      if (visibleCandles.length === 0) return

      const padding = 0.05  // 上下各留 5% 边距

      const maxPrice = Math.max(...visibleCandles.map((c) => c.high))
      const minPrice = Math.min(...visibleCandles.map((c) => c.low))
      const range = maxPrice - minPrice

      setPriceAlign({
        wenhuaMaxPrice: maxPrice + range * padding,
        wenhuaMinPrice: minPrice - range * padding,
        pixelTop: chartHeight * padding,
        pixelBottom: chartHeight * (1 - padding)
      })
    },
    [setPriceAlign]
  )

  // 手动微调：上下移动价格轴（按像素偏移）
  const nudgeVertical = useCallback(
    (deltaPixel: number) => {
      const { wenhuaMinPrice, wenhuaMaxPrice, pixelTop, pixelBottom } = priceAlign
      const priceRange = wenhuaMaxPrice - wenhuaMinPrice
      const pixelHeight = pixelBottom - pixelTop
      const pricePerPixel = priceRange / pixelHeight
      const deltaPrice = deltaPixel * pricePerPixel

      setPriceAlign({
        wenhuaMinPrice: wenhuaMinPrice - deltaPrice,
        wenhuaMaxPrice: wenhuaMaxPrice - deltaPrice
      })
    },
    [priceAlign, setPriceAlign]
  )

  // 手动缩放：调整价格轴比例
  const scaleVertical = useCallback(
    (factor: number) => {
      const { wenhuaMinPrice, wenhuaMaxPrice } = priceAlign
      const mid = (wenhuaMinPrice + wenhuaMaxPrice) / 2
      const half = ((wenhuaMaxPrice - wenhuaMinPrice) / 2) * factor

      setPriceAlign({
        wenhuaMinPrice: mid - half,
        wenhuaMaxPrice: mid + half
      })
    },
    [priceAlign, setPriceAlign]
  )

  return {
    priceAlign,
    setPriceAlign,
    priceToPixel,
    pixelToPrice,
    autoAlign,
    nudgeVertical,
    scaleVertical
  }
}
