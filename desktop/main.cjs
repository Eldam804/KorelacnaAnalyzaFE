const {
  app,
  BrowserWindow,
  dialog,
  shell
} = require('electron');

const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

let mainWindow = null;
let backendProcess = null;
let ownsBackendProcess = false;
let isQuitting = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findFileRecursive(rootDirectory, fileName) {
  if (!fs.existsSync(rootDirectory)) {
    return null;
  }

  const stack = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop();
    const entries = fs.readdirSync(
      currentDirectory,
      { withFileTypes: true }
    );

    for (const entry of entries) {
      const fullPath = path.join(
        currentDirectory,
        entry.name
      );

      if (entry.isFile() && entry.name === fileName) {
        return fullPath;
      }

      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }

  return null;
}

function getFrontendRoot() {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'frontend'
    );
  }

  return path.join(
    __dirname,
    'frontend'
  );
}

function getBackendPath() {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'backend',
      'correlation-backend.exe'
    );
  }

  return path.join(
    __dirname,
    'backend',
    'correlation-backend.exe'
  );
}

function isCorrelationBackendReady() {
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
              response.statusCode === undefined ||
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
                  .includes('correlation graph backend')
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
      1000,
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

async function startBackend() {
  if (await isCorrelationBackendReady()) {
    return;
  }

  const backendPath = getBackendPath();

  if (!fs.existsSync(backendPath)) {
    throw new Error(
      `Backend executable was not found:\n${backendPath}`
    );
  }

  backendProcess = spawn(
    backendPath,
    [],
    {
      cwd: path.dirname(backendPath),
      windowsHide: true,
      stdio: app.isPackaged
        ? 'ignore'
        : 'inherit'
    }
  );

  ownsBackendProcess = true;

  backendProcess.on(
    'error',
    error => {
      if (!isQuitting) {
        console.error(
          'Backend process error:',
          error
        );
      }
    }
  );

  const timeoutAt = Date.now() + 30000;

  while (Date.now() < timeoutAt) {
    if (await isCorrelationBackendReady()) {
      return;
    }

    if (
      backendProcess.exitCode !== null &&
      backendProcess.exitCode !== undefined
    ) {
      throw new Error(
        `Backend exited before becoming ready. Exit code: ${backendProcess.exitCode}`
      );
    }

    await sleep(250);
  }

  throw new Error(
    `Backend did not become ready within 30 seconds at ${BACKEND_URL}.`
  );
}

function stopBackend() {
  if (
    !ownsBackendProcess ||
    !backendProcess ||
    backendProcess.killed
  ) {
    return;
  }

  try {
    backendProcess.kill();
  }
  catch {
  }

  backendProcess = null;
  ownsBackendProcess = false;
}

async function createWindow() {
  const frontendRoot = getFrontendRoot();
  const indexHtml = findFileRecursive(
    frontendRoot,
    'index.html'
  );

  if (!indexHtml) {
    throw new Error(
      `Angular index.html was not found below:\n${frontendRoot}`
    );
  }

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      preload: path.join(
        __dirname,
        'preload.cjs'
      ),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(
    ({ url }) => {
      shell.openExternal(url);
      return {
        action: 'deny'
      };
    }
  );

  mainWindow.once(
    'ready-to-show',
    () => {
      mainWindow?.show();
    }
  );

  await mainWindow.loadFile(indexHtml);

  mainWindow.on(
    'closed',
    () => {
      mainWindow = null;
    }
  );
}

const hasSingleInstanceLock =
  app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
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

        app.quit();
      }
    });

  app.on(
    'activate',
    async () => {
      if (BrowserWindow.getAllWindows().length > 0) {
        return;
      }

      try {
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
      }
    }
  );

  app.on(
    'before-quit',
    () => {
      isQuitting = true;
      stopBackend();
    }
  );

  app.on(
    'window-all-closed',
    () => {
      app.quit();
    }
  );
}
