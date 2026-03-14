import { contextBridge, ipcRenderer } from 'electron'

// ─── 安全地将 Electron API 暴露给渲染进程 ──────────────────────────────────
contextBridge.exposeInMainWorld('electronAPI', {
  // ── 模式控制 ──
  toggleMode: () => ipcRenderer.send('toggle-mode'),
  getMode: () => ipcRenderer.invoke('get-mode'),
  onModeChanged: (callback: (data: { mode: 'observe' | 'draw' }) => void) => {
    ipcRenderer.on('mode-changed', (_event, data) => callback(data))
    // 返回清除函数
    return () => ipcRenderer.removeAllListeners('mode-changed')
  },

  // ── 窗口控制 ──
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('set-window-bounds', bounds),

  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),

  setOpacity: (opacity: number) => ipcRenderer.send('set-opacity', opacity),
})

// ─── TypeScript 类型声明（供渲染进程使用）──────────────────────────────────
// 在 src/types/global.d.ts 中使用
