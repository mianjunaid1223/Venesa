/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: System Tray
 *  Creates and manages the Venesa tray icon and context menu so
 *  users can see the app is running in the background and quickly
 *  access common actions without the main window open.
 * ═══════════════════════════════════════════════════════════════
 */

const { Tray, Menu, app, nativeImage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

let tray = null;

/**
 * Resolves the icon path according to whether the app is packaged.
 */
function getIconPath() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'assets')
    : path.join(__dirname, '../../assets');

  // Prefer a small 16×16 tray-specific icon when available, fall back to the
  // main icon.
  const candidates = ['tray-icon.png', 'tray-icon.ico', 'icon.ico', 'logo.png'];
  for (const candidate of candidates) {
    const full = path.join(base, candidate);
    if (fs.existsSync(full)) return full;
  }
  return path.join(base, 'icon.ico');
}

/**
 * Reads the persisted open-at-login setting.
 */
function isAutoStartEnabled() {
  try {
    const settingsPath = path.join(os.homedir(), '.venesa-settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      return settings.openAtLogin === true;
    }
  } catch (_) {}
  return false;
}

/**
 * Persists and applies the open-at-login setting.
 */
function setAutoStart(enabled) {
  try {
    const settingsPath = path.join(os.homedir(), '.venesa-settings.json');
    let settings = {};
    if (fs.existsSync(settingsPath)) {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    settings.openAtLogin = enabled;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (_) {}

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath('exe'),
    args: enabled ? ['--hidden'] : [],
  });
}

/**
 * Builds and sets the tray context menu.
 * Called on creation and whenever state changes (e.g. auto-start toggle).
 *
 * @param {object} deps - Injected window helpers from main.js
 * @param {() => void} deps.showMain    - Show / focus the main window
 * @param {() => void} deps.showVoice   - Open voice mode
 * @param {() => void} deps.showSettings - Open settings window
 */
function buildContextMenu(deps) {
  const { showMain, showVoice, showSettings } = deps;
  const autoStart = isAutoStartEnabled();

  return Menu.buildFromTemplate([
    {
      label: 'Venesa',
      enabled: false,
      // This acts as a bold header row in most OS tray menus
    },
    { type: 'separator' },
    {
      label: 'Show Venesa',
      click: () => showMain(),
    },
    {
      label: 'Voice Mode',
      accelerator: 'Ctrl+Shift+V',
      click: () => showVoice(),
    },
    {
      label: 'Settings',
      accelerator: 'Ctrl+,',
      click: () => showSettings(),
    },
    { type: 'separator' },
    {
      label: 'Open at Login',
      type: 'checkbox',
      checked: autoStart,
      click: (menuItem) => {
        setAutoStart(menuItem.checked);
        // Rebuild menu so the checked state persists visually
        if (tray && !tray.isDestroyed()) {
          tray.setContextMenu(buildContextMenu(deps));
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Venesa',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

/**
 * Creates the tray icon. Safe to call multiple times (no-op after first call).
 *
 * @param {object} deps - See buildContextMenu() docs above.
 */
function createTray(deps) {
  if (tray && !tray.isDestroyed()) return;

  const iconPath = getIconPath();
  const icon = nativeImage.createFromPath(iconPath);

  // On Windows the tray icon should be small (16×16); resize if needed.
  if (process.platform === 'win32' && !icon.isEmpty()) {
    const resized = icon.resize({ width: 16, height: 16 });
    tray = new Tray(resized);
  } else {
    tray = new Tray(icon);
  }

  tray.setToolTip('Venesa — running in background');
  tray.setContextMenu(buildContextMenu(deps));

  // Left-click / double-click also opens the main window for convenience.
  tray.on('click', () => deps.showMain());
  tray.on('double-click', () => deps.showMain());
}

/**
 * Destroys the tray icon (called on quit).
 */
function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };
