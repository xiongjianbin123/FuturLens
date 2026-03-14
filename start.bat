@echo off
chcp 65001 > nul
title FuturLens 启动器

echo ========================================
echo   FuturLens 期货辅助决策工具 启动器
echo ========================================
echo.

:: 检查是否安装了 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js 18+
    pause
    exit /b 1
)

:: 检查是否安装了 Python
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Python，请先安装 Python 3.10+
    pause
    exit /b 1
)

:: 安装前端依赖（首次运行）
if not exist "node_modules" (
    echo [1/3] 安装前端依赖...
    npm install
    if %errorlevel% neq 0 (
        echo [错误] npm install 失败
        pause
        exit /b 1
    )
)

:: 安装 Python 依赖（首次运行）
python -c "import websockets" >nul 2>nul
if %errorlevel% neq 0 (
    echo [2/3] 安装 Python 依赖...
    pip install -r python\requirements.txt
)

echo.
echo 选择模式：
echo   [1] 开发模式（模拟行情 + Electron 热重载）
echo   [2] 开发模式（真实 TqSdk 行情）
echo   [3] 仅启动模拟行情服务器
echo.
set /p choice=请输入选项 (1/2/3):

if "%choice%"=="1" goto dev_mock
if "%choice%"=="2" goto dev_real
if "%choice%"=="3" goto mock_only
goto dev_mock

:dev_mock
echo.
echo [启动] 模拟行情服务器...
start "FuturLens Mock Server" cmd /k "python python\mock_server.py"
timeout /t 2 /nobreak > nul

echo [启动] Electron 开发模式...
npm run dev
goto end

:dev_real
echo.
set /p tq_account=请输入天勤账号:
set /p tq_password=请输入天勤密码:

echo [启动] 真实行情服务器...
start "FuturLens Market Server" cmd /k "python python\market_server.py --account %tq_account% --password %tq_password%"
timeout /t 3 /nobreak > nul

echo [启动] Electron 开发模式...
npm run dev
goto end

:mock_only
echo [启动] 仅模拟行情服务器（ws://localhost:8765）...
python python\mock_server.py
goto end

:end
pause
