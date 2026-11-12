@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONIOENCODING=utf-8

rem Prefer the bundled portable Python runtime (no install needed).
if exist "python\python.exe" (
  "python\python.exe" scan.py %*
  goto end
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/3] Creating Python virtual environment...
  py -3 -m venv .venv 2>nul
  if errorlevel 1 python -m venv .venv
  if not exist ".venv\Scripts\python.exe" (
    echo Python 3.9+ not found. Install Python, or put a portable runtime in this folder as python\
    pause
    exit /b 1
  )
  echo [2/3] Installing dependencies...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Failed to install dependencies. Check the network and retry.
    pause
    exit /b 1
  )
)

echo [3/3] Starting resource scanner...
".venv\Scripts\python.exe" scan.py %*
:end
pause
