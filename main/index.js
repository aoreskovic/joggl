// App lifecycle, window, tray. Everything Node-flavoured lives behind this file
// and the modules it pulls in; the renderer sees none of it.

import { app, BrowserWindow, Menu, Tray, globalShortcut, shell, nativeImage } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { initCredentials } from './credentials.js';
import { applyDevCredentials } from './dev-credentials.js';
import { registerIpc } from './ipc.js';
import * as log from './log.js';
import { initStore } from './store.js';
import { getUiPrefs, saveUiPrefs } from './settings.js';

const ROOT = path.join(import.meta.dirname, '..');
const ICON = path.join(ROOT, 'assets', 'icon.png');
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+J';

let mainWindow = null;
let tray = null;
let quitting = false;

/**
 * `npm run uicheck` — drive the manual checklist as a script. See
 * scripts/ui-check.mjs.
 *
 * userData is redirected before anything reads it, so a run can never touch a
 * real day log, and the single-instance lock is skipped so a check can run while
 * the app is open. Both have to happen here, before `whenReady`.
 */
const uiCheck = process.argv.includes('--uicheck');
if (uiCheck) {
  app.setPath('userData', path.join(app.getPath('temp'), `joggl-uicheck-${process.pid}`));
}

// One instance only: two copies writing the same day log would race each other.
if (!uiCheck && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start).catch(fatal);
}

async function start() {
  // In development the log sits in the project directory where it is easy to
  // tail; a packaged build has no writable install directory, so it goes to
  // userData alongside the day logs.
  await log.initLogger({
    dir: process.env.JOGGL_LOG_DIR ?? path.join(app.isPackaged ? app.getPath('userData') : ROOT, 'logs'),
  });
  log.info(
    `Joggl ${app.getVersion()} starting — Electron ${process.versions.electron}, ` +
      `Node ${process.versions.node}, ${process.platform}`,
  );
  log.info(`Log file: ${log.getLogPath()}`);
  log.info(`User data: ${app.getPath('userData')}`);

  await initStore(app.getPath('userData'));
  initCredentials();
  await applyDevCredentials({ isPackaged: app.isPackaged, projectRoot: ROOT }).catch((err) =>
    log.error('Dev credential preset failed:', err),
  );
  registerIpc();

  await createWindow();
  createTray();

  if (!globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow)) {
    log.warn(`Could not register ${TOGGLE_SHORTCUT} — another app already owns it.`);
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
    icon: ICON,
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

  if (uiCheck) {
    // A background or occluded window has its compositor frozen: CSS transitions
    // stop advancing mid-way and `:focus` stops matching, so checks that measure a
    // slide or press a key on the focused row fail for a reason that has nothing
    // to do with the app. The launching terminal holds focus, so take it back.
    mainWindow.focus();

    const { runChecks } = await import(
      pathToFileURL(path.join(ROOT, 'scripts', 'ui-check.mjs')).href
    );
    // Long enough for the first issue load to land — several checks need a task
    // row to press.
    setTimeout(() => runChecks(mainWindow, app), 7000);
  }

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

  // Ten people cannot be debugged over the shoulder, so renderer failures end up
  // in the same file as everything else.
  mainWindow.webContents.on('console-message', (event) => {
    if (event.level === 'error' || event.level === 'warning') {
      log.log(
        event.level === 'error' ? 'error' : 'warn',
        `[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`,
      );
    }
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log.error('[renderer] process gone:', details.reason, `exit ${details.exitCode}`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, err) => {
    log.error('[preload] failed:', preloadPath, err);
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
  // Closing the window hides to the tray, so an invisible tray icon would strand
  // the app with only the global shortcut to get it back.
  const icon = nativeImage.createFromPath(ICON);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon.resize({ width: 16, height: 16 }));
  if (icon.isEmpty()) log.warn(`Tray icon missing at ${ICON} — the tray entry will be invisible.`);
  tray.setToolTip('Joggl');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Joggl', click: showWindow },
      {
        label: 'Open log folder',
        click: () => shell.showItemInFolder(log.getLogPath()),
      },
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
  log.info('Joggl exiting');
  log.closeLogger();
});

// Hiding to tray means "no windows open" is a normal state, so do not quit here.
app.on('window-all-closed', () => {});

// A crash that leaves nothing in the log is the one that cannot be diagnosed.
process.on('uncaughtException', (err) => log.error('Uncaught exception in main:', err));
process.on('unhandledRejection', (reason) => log.error('Unhandled rejection in main:', reason));

function debounce(fn, ms) {
  let handle = null;
  return (...args) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}

function fatal(err) {
  log.error('Joggl failed to start:', err);
  app.quit();
}
