@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "DESKTOP_DIR=%CD%"
for %%I in ("%DESKTOP_DIR%\..") do set "PROJECT_ROOT=%%~fI"

echo ================================================
echo Correlation Monoliths - Desktop Builder
echo ================================================
echo.
echo Angular project:
echo %PROJECT_ROOT%
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js was not found in PATH.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm was not found in PATH.
    pause
    exit /b 1
)

if not exist "%PROJECT_ROOT%\package.json" (
    echo ERROR: package.json was not found in the Angular project root.
    echo The desktop folder must be directly inside the Angular project.
    pause
    exit /b 1
)

set "BACKEND_SOURCE=%~1"

if not defined BACKEND_SOURCE (
    if exist "%DESKTOP_DIR%\backend\correlation-backend.exe" (
        set "BACKEND_SOURCE=%DESKTOP_DIR%\backend\correlation-backend.exe"
    )
)

if not defined BACKEND_SOURCE (
    if exist "%PROJECT_ROOT%\backend\dist\correlation-backend.exe" (
        set "BACKEND_SOURCE=%PROJECT_ROOT%\backend\dist\correlation-backend.exe"
    )
)

if not defined BACKEND_SOURCE (
    if exist "%PROJECT_ROOT%\..\backend\dist\correlation-backend.exe" (
        set "BACKEND_SOURCE=%PROJECT_ROOT%\..\backend\dist\correlation-backend.exe"
    )
)

if not defined BACKEND_SOURCE (
    echo Backend executable was not found automatically.
    echo.
    echo Paste the full path to correlation-backend.exe:
    set /p "BACKEND_SOURCE=> "
)

if not exist "%BACKEND_SOURCE%" (
    echo.
    echo ERROR: Backend executable does not exist:
    echo %BACKEND_SOURCE%
    pause
    exit /b 1
)

echo [1/6] Installing Angular dependencies if needed...
cd /d "%PROJECT_ROOT%"

if not exist "node_modules" (
    call npm install
    if errorlevel 1 goto :error
)

echo [2/6] Building Angular for Electron...
call npx ng build --configuration production --base-href ./
if errorlevel 1 goto :error

if not exist "%PROJECT_ROOT%\dist" (
    echo ERROR: Angular build finished but dist folder was not created.
    goto :error
)

echo [3/6] Copying Angular build into desktop package...
if exist "%DESKTOP_DIR%\frontend" (
    rmdir /s /q "%DESKTOP_DIR%\frontend"
)

mkdir "%DESKTOP_DIR%\frontend"
xcopy "%PROJECT_ROOT%\dist\*" "%DESKTOP_DIR%\frontend\" /E /I /Y >nul
if errorlevel 1 goto :error

echo [4/6] Copying Python backend...
if not exist "%DESKTOP_DIR%\backend" (
    mkdir "%DESKTOP_DIR%\backend"
)

copy /Y "%BACKEND_SOURCE%" "%DESKTOP_DIR%\backend\correlation-backend.exe" >nul
if errorlevel 1 goto :error

echo [5/6] Installing Electron packaging dependencies...
cd /d "%DESKTOP_DIR%"

call npm install
if errorlevel 1 goto :error

echo [6/6] Building one portable Windows EXE...
if exist "%DESKTOP_DIR%\release" (
    rmdir /s /q "%DESKTOP_DIR%\release"
)

call npm run dist
if errorlevel 1 goto :error

echo.
echo ================================================
echo DESKTOP BUILD SUCCESSFUL
echo ================================================
echo.
echo Output folder:
echo %DESKTOP_DIR%\release
echo.
echo Look for:
echo Correlation-Monoliths-1.0.0-portable.exe
echo.
pause
exit /b 0

:error
echo.
echo ================================================
echo DESKTOP BUILD FAILED
echo ================================================
echo Check the error above.
pause
exit /b 1
