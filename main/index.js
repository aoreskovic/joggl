// App lifecycle, window, tray. Everything Node-flavoured lives behind this file
// and the modules it pulls in; the renderer sees none of it.

import { app, BrowserWindow, Menu, Tray, globalShortcut, shell, nativeImage } from 'electron';
import path from 'node:path';

import { initCredentials } from './credentials.js';
import { registerIpc } from './ipc.js';
import { initStore } from './store.js';
import { getUiPrefs, saveUiPrefs } from './settings.js';

const ROOT = path.join(import.meta.dirname, '..');
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+J';

let mainWindow = null;
let tray = null;
let quitting = false;

// One instance only: two copies writing the same day log would race each other.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start).catch(fatal);
}

async function start() {
  await initStore(app.getPath('userData'));
  initCredentials();
  registerIpc();

  await createWindow();
  createTray();

  if (!globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow)) {
    console.warn(`Could not register ${TOGGLE_SHORTCUT} — another app already owns it.`);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else showWindow();
  });
}

async function createWindow() {
  const prefs = await getUiPrefs();

  mainWindow = new BrowserWindow({
    width: prefs.windowWidth ?? 1180,
    height: prefs.windowHeight ?? 780,
    minWidth: 720,
    minHeight: 480,
    title: 'Joggl',
    backgroundColor: '#14161a',
    show: false,
    webPreferences: {
      preload: path.join(ROOT, 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  await mainWindow.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  mainWindow.show();

  mainWindow.on('resize', debounce(persistBounds, 500));

  // Closing the window hides to tray; only Quit actually exits, so a running
  // timer is not lost to a stray Alt+F4.
  mainWindow.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Ten people cannot be debugged over the shoulder, so renderer failures are
  // surfaced where `--enable-logging` will show them.
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      console.error(`[renderer:${event.level}] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone:', details.reason, details.exitCode);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error('[preload] failed:', preloadPath, error);
  });

  // The renderer has no business navigating anywhere. Links open in the real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) event.preventDefault();
  });
}

async function persistBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const [windowWidth, windowHeight] = mainWindow.getSize();
  await saveUiPrefs({ windowWidth, windowHeight }).catch(() => {});
}

function createTray() {
  // No icon asset yet — an empty image still gives a working tray entry rather
  // than crashing on a missing file.
  tray = new Tray(nativeImage.createEmpty());
  tray.setToolTip('Joggl');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Joggl', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', toggleWindow);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Hiding to tray means "no windows open" is a normal state, so do not quit here.
app.on('window-all-closed', () => {});

function debounce(fn, ms) {
  let handle = null;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

function fatal(err) {
  console.error('Joggl failed to start:', err);
  app.quit();
}
