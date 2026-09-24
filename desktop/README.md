# Correlation Monoliths Desktop

Put this `desktop` folder directly inside the existing Angular project.

Expected layout:

```text
KorelacnaAnalyzaFE/
├─ src/
├─ angular.json
├─ package.json
├─ dist/
└─ desktop/
   ├─ main.cjs
   ├─ preload.cjs
   ├─ package.json
   ├─ build_desktop.bat
   ├─ test_desktop.bat
   └─ backend/
```

## Build

Run:

```text
desktop\build_desktop.bat
```

The script:

1. builds the existing Angular project with `--base-href ./`,
2. copies the Angular `dist` folder into the Electron package,
3. copies `correlation-backend.exe`,
4. installs Electron + electron-builder,
5. creates one portable Windows executable.

If the backend executable cannot be found automatically, the script asks for its full path.

You can also pass it directly:

```text
build_desktop.bat "D:\path\to\correlation-backend.exe"
```

## Test Electron before packaging

After one successful prepare/build run:

```text
desktop\test_desktop.bat
```

Electron starts `backend\correlation-backend.exe`, waits for
`http://127.0.0.1:8000/`, then opens the Angular production build.

## Output

```text
desktop\release\Correlation-Monoliths-1.0.0-portable.exe
```

The portable target is a single distributable `.exe`. It extracts its packaged
resources to a temporary directory while running.

## Backend

The current frontend already communicates with the backend over port 8000.
The Electron wrapper therefore starts the packaged backend on the same port.

For public distribution, change the backend Uvicorn host from `0.0.0.0` to
`127.0.0.1` and rebuild `correlation-backend.exe`.
