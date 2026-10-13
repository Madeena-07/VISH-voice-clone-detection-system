@echo off
setlocal
cd /d "%~dp0"
title VISH Working Prototype
where python >nul 2>nul
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3.10+ and enable "Add Python to PATH".
  pause
  exit /b 1
)
echo [VISH] Installing/checking local Python dependencies...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [VISH] Dependency installation failed.
  pause
  exit /b 1
)
echo [VISH] Starting at http://127.0.0.1:8000
start "" cmd /c "timeout /t 2 /nobreak ^>nul & start http://127.0.0.1:8000"
python run.py
pause
