import { useAppStore } from '../store/appStore'

// ─── 模式状态指示器（右上角悬浮徽章）────────────────────────────────────────
export default function ModeIndicator() {
  const { mode, wsConnected, latestTick, symbol } = useAppStore()

  const isObserve = mode === 'observe'

  return (
    <div
      className="absolute top-2 right-2 flex flex-col items-end gap-1 pointer-events-none"
      style={{ zIndex: 1000 }}
    >
      {/* 模式徽章 */}
      <div
        className={`
          flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono font-bold
          backdrop-blur-sm border transition-all duration-200
          ${isObserve
            ? 'bg-blue-500/20 border-blue-400/30 text-blue-300'
            : 'bg-amber-500/25 border-amber-400/40 text-amber-300'
          }
        `}
      >
        {/* 脉冲指示点 */}
        <span
          className={`w-2 h-2 rounded-full ${
            isObserve ? 'bg-blue-400' : 'bg-amber-400 animate-pulse'
          }`}
        />
        {isObserve ? '观察模式' : '画图模式'}
        <span className="opacity-50 text-[10px]">Alt+S</span>
      </div>

      {/* 连接状态 + 品种 + 最新价 */}
      <div className="flex items-center gap-2 px-2 py-0.5 rounded text-[11px] font-mono bg-black/40 border border-white/10">
        <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-green-400' : 'bg-red-400'}`} />
        <span className="text-white/60">{symbol.toUpperCase()}</span>
        {latestTick && (
          <span className="text-white/90 font-bold">
            {latestTick.price.toFixed(0)}
          </span>
        )}
      </div>
    </div>
  )
}
