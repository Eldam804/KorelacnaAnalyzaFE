const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const BACKEND_HOST = '127.0.0.1';
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;

let mainWindow = null;
let backendProcess = null;
let startedBackend = false;

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
    const entries = fs.readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isFile() && entry.name.toLowerCase() === 'index.html') {
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
    ? path.join(process.resourcesPath, 'backend', 'correlation-backend.exe')
    : path.join(getProjectRoot(), 'desktop', 'backend', 'correlation-backend.exe');
}

function backendReady() {
  return new Promise(resolve => {
    const request = http.get(`${BACKEND_URL}/`, response => {
      let body = '';

      response.setEncoding('utf8');

      response.on('data', chunk => {
        body += chunk;
      });

      response.on('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          resolve(false);
          return;
        }

        try {
          const data = JSON.parse(body);

          resolve(
            data?.status === 'ok' &&
            typeof data?.message === 'string' &&
            data.message.toLowerCase().includes('correlation graph backend')
          );
        }
        catch {
          resolve(false);
        }
      });
    });

    request.setTimeout(750, () => {
      request.destroy();
      resolve(false);
    });

    request.on('error', () => resolve(false));
  });
}

async function startBackend() {
  if (await backendReady()) {
    return;
  }

  const backendPath = getBackendPath();

  if (!fs.existsSync(backendPath)) {
    throw new Error(`Backend executable was not found:\n${backendPath}`);
  }

  backendProcess = spawn(backendPath, [], {
    cwd: path.dirname(backendPath),
    windowsHide: true,
    stdio: 'ignore'
  });

  startedBackend = true;

  const timeout = Date.now() + 30000;

  while (Date.now() < timeout) {
    if (await backendReady()) {
      return;
    }

    if (backendProcess.exitCode !== null) {
      throw new Error(
        `Backend exited before it became ready. Exit code: ${backendProcess.exitCode}`
      );
    }

    await sleep(250);
  }

  throw new Error(`Backend did not start within 30 seconds on ${BACKEND_URL}.`);
}

function stopBackend() {
  if (!startedBackend || !backendProcess) {
    return;
  }

  try {
    backendProcess.kill();
  }
  catch {
  }

  backendProcess = null;
  startedBackend = false;
}

async function createWindow() {
  const distRoot = path.join(getProjectRoot(), 'dist');
  const indexHtml = findIndexHtml(distRoot);

  if (!indexHtml) {
    throw new Error(`Angular index.html was not found inside:\n${distRoot}`);
  }

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  await mainWindow.loadFile(indexHtml);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const lock = app.requestSingleInstanceLock();

if (!lock) {
  app.quit();
}
else {
  app.on('second-instance', () => {
    if (!mainWindow) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
      await createWindow();
    }
    catch (error) {
      dialog.showErrorBox(
        'Correlation Monoliths',
        error instanceof Error ? error.message : String(error)
      );

      stopBackend();
      app.quit();
    }
  });

  app.on('before-quit', stopBackend);

  app.on('window-all-closed', () => {
    app.quit();
  });
}
