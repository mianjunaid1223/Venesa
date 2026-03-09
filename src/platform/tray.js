// Tray — system tray icon and context menu.

const { Tray, Menu, app, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
const settings = require("../brain/settings");

let tray = null;

function getIconPath() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "assets")
    : path.join(__dirname, "../../assets");

  // Prefer a small 16×16 tray-specific icon when available, fall back to the
  // main icon.
  const candidates = ["tray-icon.png", "tray-icon.ico", "icon.ico", "logo.png"];
  for (const candidate of candidates) {
    const full = path.join(base, candidate);
    if (fs.existsSync(full)) return full;
  }
  const fallback = path.join(base, "icon.ico");
  if (!fs.existsSync(fallback)) {
    console.warn(`[tray] No tray icon found in ${base}. Candidates: ${candidates.join(', ')}, icon.ico`);
    return null;
  }
  return fallback;
}

function isAutoStartEnabled() {
  const s = settings.load();
  return s.openAtLogin === true;
}

function setAutoStart(enabled) {
  settings.save({ openAtLogin: enabled });

  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: app.getPath("exe"),
    args: enabled ? ["--hidden"] : [],
  });
}

function buildContextMenu(deps) {
  const { showMain, showVoice, showSettings } = deps;
  const autoStart = isAutoStartEnabled();

  return Menu.buildFromTemplate([
    {
      label: "Venesa",
      enabled: false,
      // This acts as a bold header row in most OS tray menus
    },
    { type: "separator" },
    {
      label: "Show Venesa",
      click: () => showMain(),
    },
    {
      label: "Voice Mode",
      accelerator: "Ctrl+Shift+V",
      click: () => showVoice(),
    },
    {
      label: "Settings",
      accelerator: "Ctrl+,",
      click: () => showSettings(),
    },
    { type: "separator" },
    {
      label: "Open at Login",
      type: "checkbox",
      checked: autoStart,
      click: (menuItem) => {
        setAutoStart(menuItem.checked);
        // Rebuild menu so the checked state persists visually
        if (tray && !tray.isDestroyed()) {
          tray.setContextMenu(buildContextMenu(deps));
        }
      },
    },
    { type: "separator" },
    {
      label: "Quit Venesa",
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray(deps) {
  if (tray && !tray.isDestroyed()) return;

  const iconPath = getIconPath();
  if (!iconPath) {
    console.warn('[tray] No icon available — skipping tray creation');
    return;
  }
  const icon = nativeImage.createFromPath(iconPath);

  // On Windows the tray icon should be small (16×16); resize if needed.
  if (process.platform === "win32" && !icon.isEmpty()) {
    const resized = icon.resize({ width: 16, height: 16 });
    tray = new Tray(resized);
  } else {
    tray = new Tray(icon);
  }

  tray.setToolTip("Venesa — Ready to assist");
  tray.setContextMenu(buildContextMenu(deps));

  // Left-click / double-click also opens the main window for convenience.
  tray.on("click", () => deps.showMain());
  tray.on("double-click", () => deps.showMain());
}

function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
}

module.exports = { createTray, destroyTray };
