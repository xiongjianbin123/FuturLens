# FuturLens — 期货辅助决策透明浮层工具

基于 **Electron + Vite + React + TailwindCSS** 的透明悬浮窗，叠加在「文华财经」上方，提供 K 线渲染与趋势线标注功能。

## 快速开始（Windows）

### 方式一：一键启动（推荐）

```bat
# 双击或在 CMD 中运行
start.bat
```

### 方式二：手动启动

```bash
# 终端 1：启动行情服务器
# 模拟模式（无需账户，适合开发调试）
python python/mock_server.py

# 或真实行情（需要天勤账户）
python python/market_server.py --account 你的账号 --password 你的密码

# 终端 2：启动 Electron
npm install
npm run dev
```

## 项目结构

```
FuturLens/
├── electron/
│   ├── main.ts          # 主进程：透明窗口、全局快捷键、IPC
│   └── preload.ts       # 预加载：安全桥接 main ↔ renderer
├── src/
│   ├── App.tsx          # 根组件
│   ├── components/
│   │   ├── Chart.tsx         # K线图（TradingView Lightweight Charts）
│   │   ├── Toolbar.tsx       # 画图工具栏 + 价格对齐面板
│   │   └── ModeIndicator.tsx # 右上角模式徽章
│   ├── hooks/
│   │   ├── useWebSocket.ts   # WebSocket 连接 + 自动重连
│   │   └── usePriceAlign.ts  # 价格↔像素对齐算法
│   └── store/
│       └── appStore.ts       # Zustand 全局状态
└── python/
    ├── market_server.py  # TqSdk 真实行情服务器
    ├── mock_server.py    # 模拟行情服务器（无需账户）
    └── requirements.txt
```

## 快捷键

| 快捷键  | 功能                               |
| ------- | ---------------------------------- |
| `Alt+S` | **切换模式**：观察模式 ↔ 画图模式  |
| `Alt+H` | 显示 / 隐藏浮层窗口                |
| `Alt+Q` | 退出程序                           |
| `Esc`   | 退出画图模式（渲染进程内）         |

## 两种模式说明

```
观察模式（默认）               画图模式
─────────────────────────     ──────────────────────────────
鼠标穿透浮层                   浮层拦截鼠标事件
点击下方文华财经                在 K 线上画趋势线
浮层半透明（40%）              浮层不透明（设定值）
右上角蓝色徽章                 右上角金色徽章 + 橙色边框
```

## 价格对齐操作流程

1. 按 `Alt+S` 切换到**画图模式**
2. 点击左侧工具栏的 **「⟺ 对齐」** 按钮
3. 在文华财经界面观察当前可见 K 线的**最高价**和**最低价**
4. 在对齐面板中输入对应数值
5. 使用「↑10」「↓10」「+」「-」微调，直到 K 线大致重合
6. 切回**观察模式**进行分析

## Windows 透明渲染问题排查

如果窗口背景不透明（显示黑色），尝试以下步骤：

1. **检查 Windows 系统设置**：
   - 设置 → 个性化 → 颜色 → 开启「透明效果」

2. **禁用硬件加速**（如透明仍失效）：
   在 `electron/main.ts` 中取消注释：
   ```typescript
   app.disableHardwareAcceleration()
   ```

3. **检查显卡驱动**是否为最新版本

## 技术栈

| 层次       | 技术                                  |
| ---------- | ------------------------------------- |
| 桌面框架   | Electron 31 + electron-vite           |
| 前端框架   | React 18 + TypeScript                 |
| 样式       | Tailwind CSS 3                        |
| 图表       | TradingView Lightweight Charts v4     |
| 状态管理   | Zustand                               |
| 行情数据   | Python TqSdk + WebSocket              |

## 打包发布

```bash
npm run package
# 输出在 release/ 目录，Windows NSIS 安装包
```
