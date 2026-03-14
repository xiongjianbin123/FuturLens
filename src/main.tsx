import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// 禁用浏览器默认右键菜单（透明浮层场景）
document.addEventListener('contextmenu', (e) => {
  // Chart 组件内有自定义右键处理（取消画线），其余区域阻止默认菜单
  e.preventDefault()
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
