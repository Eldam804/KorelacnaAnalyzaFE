@echo off
setlocal EnableExtensions

cd /d "%~dp0"
set "PROJECT_ROOT=%CD%"

echo ==================================================
echo Correlation Monoliths - CLEAN Electron build
echo ==================================================
echo.
echo This script does NOT install Electron into the Angular project.
echo It does NOT modify package.json.
echo It does NOT touch desktop\node_modules.
echo.

if not exist "angular.json" (
    echo ERROR: Run this BAT from the Angular project root.
    echo Expected angular.json in:
    echo %PROJECT_ROOT%
    pause
    exit /b 1
)

if not exist "package.json" (
    echo ERROR: package.json is missing.
    pause
    exit /b 1
)

if not exist "electron\main.cjs" (
    echo ERROR: electron\main.cjs is missing.
    pause
    exit /b 1
)

if not exist "electron\electron-builder.yml" (
    echo ERROR: electron\electron-builder.yml is missing.
    pause
    exit /b 1
)

if not exist "desktop\backend\correlation-backend.exe" (
    echo ERROR: Python backend is missing:
    echo %PROJECT_ROOT%\desktop\backend\correlation-backend.exe
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js was not found.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo ERROR: npm was not found.
    pause
    exit /b 1
)

echo Node:
node --version
echo.

echo [1/4] Restoring Angular DEV dependencies if the builder is missing...
if not exist "node_modules\@angular-devkit\build-angular\package.json" (
    if exist "package-lock.json" (
        call npm ci --include=dev
    ) else (
        call npm install --include=dev
    )

    if errorlevel 1 goto :error
)

if not exist "node_modules\@angular-devkit\build-angular\package.json" (
    echo ERROR: @angular-devkit/build-angular is still missing.
    echo Check that it exists in devDependencies in package.json.
    goto :error
)

echo [2/4] Building Angular...
call npx ng build --configuration production --base-href ./
if errorlevel 1 goto :error

echo [3/4] Removing previous Electron output...
if exist "release" rmdir /s /q "release"

echo [4/4] Packaging with temporary Electron Builder 24.13.3...
call npm exec --yes --package=electron-builder@24.13.3 -- electron-builder --win portable --config electron\electron-builder.yml
if errorlevel 1 goto :error

echo.
echo ==================================================
echo BUILD SUCCESSFUL
echo ==================================================
echo.
echo EXE:
echo %PROJECT_ROOT%\release
echo.
pause
exit /b 0

:error
echo.
echo ==================================================
echo BUILD FAILED
echo ==================================================
echo.
echo Nothing from Electron was installed into your Angular dependencies.
echo.
pause
exit /b 1
