import { useEffect } from 'react'
import { useAppStore } from './store/appStore'
import { useWebSocket } from './hooks/useWebSocket'
import Chart from './components/Chart'
import Toolbar from './components/Toolbar'
import ModeIndicator from './components/ModeIndicator'

export default function App() {
  const { opacity, mode, setMode } = useAppStore()

  // 建立 WebSocket 连接（自动重连）
  useWebSocket()

  // 监听主进程的模式切换通知
  useEffect(() => {
    if (!window.electronAPI) return

    const cleanup = window.electronAPI.onModeChanged(({ mode }) => {
      setMode(mode)
    })

    // 获取初始模式
    window.electronAPI.getMode().then((m) => setMode(m))

    return cleanup
  }, [setMode])

  // 键盘快捷键（渲染进程补充）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Alt+S 通过全局快捷键处理，这里处理画图辅助键
      if (e.key === 'Escape' && mode === 'draw') {
        // Esc 退出画图模式
        window.electronAPI?.toggleMode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [mode])

  return (
    <div
      className="fixed inset-0 overflow-hidden"
      style={{
        // 整体透明度由主进程控制（electronAPI.setOpacity），
        // 这里单独控制 UI 覆盖层的透明度
        opacity: mode === 'observe' ? opacity * 0.4 : opacity
      }}
    >
      {/* K 线图层（全屏） */}
      <Chart />

      {/* 模式指示器（右上角） */}
      <ModeIndicator />

      {/* 工具栏（画图模式显示） */}
      <Toolbar />

      {/* 画图模式边框提示 */}
      {mode === 'draw' && (
        <div
          className="pointer-events-none absolute inset-0 rounded-none"
          style={{
            boxShadow: 'inset 0 0 0 2px rgba(245, 158, 11, 0.4)'
          }}
        />
      )}
    </div>
  )
}
