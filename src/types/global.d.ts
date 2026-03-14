// Electron preload 暴露的 API 类型声明
interface ElectronAPI {
  toggleMode: () => void
  getMode: () => Promise<'observe' | 'draw'>
  onModeChanged: (callback: (data: { mode: 'observe' | 'draw' }) => void) => () => void
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  setOpacity: (opacity: number) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
