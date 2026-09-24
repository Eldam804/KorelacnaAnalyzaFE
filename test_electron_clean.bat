@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist "dist" (
    echo Building Angular first...
    call npx ng build --configuration production --base-href ./
    if errorlevel 1 goto :error
)

if not exist "desktop\backend\correlation-backend.exe" (
    echo ERROR: desktop\backend\correlation-backend.exe is missing.
    pause
    exit /b 1
)

call npm exec --yes --package=electron@31.7.7 -- electron electron\main.cjs
exit /b %errorlevel%

:error
pause
exit /b 1
