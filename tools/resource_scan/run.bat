@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] 创建 Python 虚拟环境...
  py -3 -m venv .venv 2>nul
  if errorlevel 1 python -m venv .venv
  if not exist ".venv\Scripts\python.exe" (
    echo 创建虚拟环境失败，请先安装 Python 3.9+ 并加入 PATH。
    pause
    exit /b 1
  )
  echo [2/3] 安装依赖...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo [3/3] 启动资源识别脚本...
".venv\Scripts\python.exe" scan.py %*
pause
