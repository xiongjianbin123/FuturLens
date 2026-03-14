import { useState } from 'react'
import { useAppStore } from '../store/appStore'
import { usePriceAlign } from '../hooks/usePriceAlign'

// ─── 工具栏（左侧边栏，仅画图模式可见/可交互）────────────────────────────────
export default function Toolbar() {
  const { mode, symbol, setSymbol, clearTrendLines, opacity, setOpacity } = useAppStore()
  const { priceAlign, setPriceAlign, nudgeVertical, scaleVertical } = usePriceAlign()
  const [inputSymbol, setInputSymbol] = useState(symbol)
  const [showAlignPanel, setShowAlignPanel] = useState(false)

  if (mode === 'observe') return null

  return (
    <div
      className="absolute left-2 top-1/2 -translate-y-1/2 flex flex-col gap-2"
      style={{ zIndex: 1000 }}
    >
      {/* 工具区 */}
      <div className="bg-panel border border-border rounded-xl p-2 flex flex-col gap-1.5 backdrop-blur-md">
        {/* 趋势线说明 */}
        <Tip>单击起点→终点画线</Tip>
        <Tip>双击删除最后一条</Tip>
        <Tip>右键取消绘制</Tip>

        <Divider />

        {/* 清除所有趋势线 */}
        <ToolBtn
          title="清除趋势线"
          onClick={clearTrendLines}
          className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
        >
          🗑 清除
        </ToolBtn>

        <Divider />

        {/* 透明度滑块 */}
        <label className="text-white/40 text-[10px] font-mono">透明度</label>
        <input
          type="range"
          min={0.2}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => {
            const val = parseFloat(e.target.value)
            setOpacity(val)
            window.electronAPI?.setOpacity(val)
          }}
          className="w-24 accent-amber-400"
        />

        <Divider />

        {/* 品种切换 */}
        <label className="text-white/40 text-[10px] font-mono">品种</label>
        <div className="flex gap-1">
          <input
            type="text"
            value={inputSymbol}
            onChange={(e) => setInputSymbol(e.target.value.toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSymbol(inputSymbol)
            }}
            className="w-20 bg-white/5 border border-white/10 rounded px-1.5 py-0.5
                       text-[11px] font-mono text-white/80 outline-none
                       focus:border-amber-400/50"
            placeholder="rb2505"
          />
          <ToolBtn
            title="确认切换品种"
            onClick={() => setSymbol(inputSymbol)}
            className="text-amber-400 hover:text-amber-300"
          >
            ↵
          </ToolBtn>
        </div>

        <Divider />

        {/* 价格对齐面板 */}
        <ToolBtn
          title="展开价格对齐配置"
          onClick={() => setShowAlignPanel(!showAlignPanel)}
          className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-400/10"
        >
          ⟺ 对齐
        </ToolBtn>
      </div>

      {/* 价格对齐面板（展开） */}
      {showAlignPanel && (
        <div className="bg-panel border border-border rounded-xl p-3 backdrop-blur-md w-44">
          <p className="text-white/40 text-[10px] font-mono mb-2">价格对齐（文华财经区间）</p>

          <AlignInput
            label="最高价"
            value={priceAlign.wenhuaMaxPrice}
            onChange={(v) => setPriceAlign({ wenhuaMaxPrice: v })}
          />
          <AlignInput
            label="最低价"
            value={priceAlign.wenhuaMinPrice}
            onChange={(v) => setPriceAlign({ wenhuaMinPrice: v })}
          />
          <AlignInput
            label="像素顶部 Y"
            value={priceAlign.pixelTop}
            onChange={(v) => setPriceAlign({ pixelTop: v })}
          />
          <AlignInput
            label="像素底部 Y"
            value={priceAlign.pixelBottom}
            onChange={(v) => setPriceAlign({ pixelBottom: v })}
          />

          <Divider />

          <p className="text-white/40 text-[10px] font-mono mb-1">快速微调</p>
          <div className="flex gap-1 flex-wrap">
            <ToolBtn onClick={() => nudgeVertical(-10)} title="上移10px" className="text-white/60">↑10</ToolBtn>
            <ToolBtn onClick={() => nudgeVertical(10)} title="下移10px" className="text-white/60">↓10</ToolBtn>
            <ToolBtn onClick={() => scaleVertical(1.1)} title="放大" className="text-white/60">+</ToolBtn>
            <ToolBtn onClick={() => scaleVertical(0.9)} title="缩小" className="text-white/60">-</ToolBtn>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 子组件 ──────────────────────────────────────────────────────────────────
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-white/30 text-[10px] font-mono leading-relaxed">{children}</p>
  )
}

function Divider() {
  return <hr className="border-white/10 my-0.5" />
}

function ToolBtn({
  children,
  onClick,
  title,
  className = ''
}: {
  children: React.ReactNode
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`
        px-2 py-1 rounded text-[11px] font-mono cursor-pointer
        transition-colors duration-150 text-left w-full
        ${className}
      `}
    >
      {children}
    </button>
  )
}

function AlignInput({
  label,
  value,
  onChange
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <label className="text-white/40 text-[10px] font-mono w-20">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-20 bg-white/5 border border-white/10 rounded px-1.5 py-0.5
                   text-[11px] font-mono text-white/80 outline-none text-right
                   focus:border-amber-400/50"
      />
    </div>
  )
}
