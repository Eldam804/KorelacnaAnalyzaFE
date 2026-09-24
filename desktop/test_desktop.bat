@echo off
setlocal

cd /d "%~dp0"

if not exist "frontend" (
    echo ERROR: frontend folder is missing.
    echo Run build_desktop.bat first.
    pause
    exit /b 1
)

if not exist "backend\correlation-backend.exe" (
    echo ERROR: backend\correlation-backend.exe is missing.
    echo Run build_desktop.bat first.
    pause
    exit /b 1
)

if not exist "node_modules" (
    call npm install
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

call npm start
