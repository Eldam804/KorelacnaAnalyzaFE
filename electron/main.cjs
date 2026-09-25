const {
  app,
  BrowserWindow,
  dialog
} = require('electron');

const {
  spawn,
  spawnSync
} = require('child_process');

const fs = require('fs');
const http = require('http');
const path = require('path');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 8000;
const BACKEND_URL =
  `http://${BACKEND_HOST}:${BACKEND_PORT}`;

const BACKEND_PROCESS_NAME =
  'correlation-backend.exe';

let mainWindow = null;
let backendProcess = null;
let startedBackend = false;
let shuttingDown = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findIndexHtml(directory) {
  if (!fs.existsSync(directory)) {
    return null;
  }

  const stack = [directory];

  while (stack.length > 0) {
    const current = stack.pop();

    const entries = fs.readdirSync(
      current,
      {
        withFileTypes: true
      }
    );

    for (const entry of entries) {
      const fullPath = path.join(
        current,
        entry.name
      );

      if (
        entry.isFile() &&
        entry.name.toLowerCase() === 'index.html'
      ) {
        return fullPath;
      }

      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
}

function getProjectRoot() {
  return app.isPackaged
    ? app.getAppPath()
    : path.resolve(__dirname, '..');
}

function getBackendPath() {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        'backend',
        BACKEND_PROCESS_NAME
      )
    : path.join(
        getProjectRoot(),
        'desktop',
        'backend',
        BACKEND_PROCESS_NAME
      );
}

function backendReady() {
  return new Promise(resolve => {
    const request = http.get(
      `${BACKEND_URL}/`,
      response => {
        let body = '';

        response.setEncoding('utf8');

        response.on(
          'data',
          chunk => {
            body += chunk;
          }
        );

        response.on(
          'end',
          () => {
            if (
              !response.statusCode ||
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              resolve(false);
              return;
            }

            try {
              const data = JSON.parse(body);

              resolve(
                data?.status === 'ok' &&
                typeof data?.message === 'string' &&
                data.message
                  .toLowerCase()
                  .includes(
                    'correlation graph backend'
                  )
              );
            }
            catch {
              resolve(false);
            }
          }
        );
      }
    );

    request.setTimeout(
      750,
      () => {
        request.destroy();
        resolve(false);
      }
    );

    request.on(
      'error',
      () => resolve(false)
    );
  });
}

function killBackendProcessTreeByPid(pid) {
  if (!pid) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      spawnSync(
        'taskkill',
        [
          '/PID',
          String(pid),
          '/T',
          '/F'
        ],
        {
          windowsHide: true,
          stdio: 'ignore'
        }
      );

      return;
    }

    process.kill(
      pid,
      'SIGTERM'
    );
  }
  catch {
  }
}

function killStalePackagedBackend() {
  if (process.platform !== 'win32') {
    return;
  }

  try {
    spawnSync(
      'taskkill',
      [
        '/IM',
        BACKEND_PROCESS_NAME,
        '/T',
        '/F'
      ],
      {
        windowsHide: true,
        stdio: 'ignore'
      }
    );
  }
  catch {
  }
}

async function waitForBackendToStop(
  timeoutMs = 5000
) {
  const timeout =
    Date.now() + timeoutMs;

  while (Date.now() < timeout) {
    if (!(await backendReady())) {
      return true;
    }

    await sleep(100);
  }

  return false;
}

async function startBackend() {
  if (await backendReady()) {
    killStalePackagedBackend();

    const stopped =
      await waitForBackendToStop();

    if (!stopped) {
      throw new Error(
        `Port ${BACKEND_PORT} is already occupied by a Correlation Monoliths backend that could not be stopped.`
      );
    }
  }

  const backendPath =
    getBackendPath();

  if (!fs.existsSync(backendPath)) {
    throw new Error(
      `Backend executable was not found:\n${backendPath}`
    );
  }

  const child = spawn(
    backendPath,
    [],
    {
      cwd: path.dirname(backendPath),
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    }
  );

  backendProcess = child;
  startedBackend = true;

  child.on(
    'exit',
    () => {
      if (backendProcess === child) {
        backendProcess = null;
        startedBackend = false;
      }
    }
  );

  child.on(
    'error',
    error => {
      if (!shuttingDown) {
        console.error(
          'Backend process error:',
          error
        );
      }
    }
  );

  const timeout =
    Date.now() + 30000;

  while (Date.now() < timeout) {
    if (await backendReady()) {
      return;
    }

    if (
      child.exitCode !== null &&
      child.exitCode !== undefined
    ) {
      throw new Error(
        `Backend exited before it became ready. Exit code: ${child.exitCode}`
      );
    }

    await sleep(250);
  }

  killBackendProcessTreeByPid(
    child.pid
  );

  backendProcess = null;
  startedBackend = false;

  throw new Error(
    `Backend did not start within 30 seconds on ${BACKEND_URL}.`
  );
}

function stopBackend() {
  if (
    !startedBackend ||
    !backendProcess
  ) {
    return;
  }

  const child =
    backendProcess;

  backendProcess = null;
  startedBackend = false;

  killBackendProcessTreeByPid(
    child.pid
  );
}

function injectDesktopTitleBarCss() {
  if (!mainWindow) {
    return;
  }

  const css = `
    .main-toolbar {
      -webkit-app-region: drag !important;
      user-select: none !important;
      padding-right: 150px !important;
    }

    .main-toolbar .actions,
    .main-toolbar button,
    .main-toolbar a,
    .main-toolbar input,
    .main-toolbar select,
    .main-toolbar textarea,
    .main-toolbar .mat-mdc-button-base {
      -webkit-app-region: no-drag !important;
    }
  `;

  mainWindow.webContents
    .insertCSS(css)
    .catch(() => {});
}

async function createWindow() {
  const distRoot = path.join(
    getProjectRoot(),
    'dist'
  );

  const indexHtml =
    findIndexHtml(distRoot);

  if (!indexHtml) {
    throw new Error(
      `Angular index.html was not found inside:\n${distRoot}`
    );
  }

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',

    titleBarStyle: 'hidden',

    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#1f2937',
      height: 64
    },

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.on(
    'did-finish-load',
    () => {
      injectDesktopTitleBarCss();
    }
  );

  mainWindow.once(
    'ready-to-show',
    () => {
      mainWindow?.show();
    }
  );

  mainWindow.on(
    'close',
    () => {
      shuttingDown = true;
      stopBackend();
    }
  );

  mainWindow.on(
    'closed',
    () => {
      mainWindow = null;
    }
  );

  await mainWindow.loadFile(
    indexHtml
  );
}

const lock =
  app.requestSingleInstanceLock();

if (!lock) {
  app.quit();
}
else {
  app.on(
    'second-instance',
    () => {
      if (!mainWindow) {
        return;
      }

      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }

      mainWindow.focus();
    }
  );

  app.whenReady()
    .then(async () => {
      try {
        await startBackend();
        await createWindow();
      }
      catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        dialog.showErrorBox(
          'Correlation Monoliths',
          message
        );

        shuttingDown = true;
        stopBackend();
        app.quit();
      }
    });

  app.on(
    'before-quit',
    () => {
      shuttingDown = true;
      stopBackend();
    }
  );

  app.on(
    'window-all-closed',
    () => {
      shuttingDown = true;
      stopBackend();
      app.quit();
    }
  );

  process.on(
    'exit',
    () => {
      stopBackend();
    }
  );
}
