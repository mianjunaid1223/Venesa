// Platform Entry Point — Electron app lifecycle, global shortcuts, protocol, and IPC wiring.
const {
  app,
  protocol,
  net,
  globalShortcut,
  ipcMain,
  screen,
} = require("electron");
const path = require("path");

const fs = require("fs");
const os = require("os");

let envPath;
if (app.isPackaged) {
  // Production: use ~/.venesa/.env (user-writable).
  // On first run, seed it from the bundled .env so any defaults carry over.
  const venesaDir = path.join(os.homedir(), ".venesa");
  envPath = path.join(venesaDir, ".env");
  try {
    if (!fs.existsSync(venesaDir)) fs.mkdirSync(venesaDir, { recursive: true });
    if (!fs.existsSync(envPath)) {
      const bundled = path.join(process.resourcesPath, ".env");
      if (fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, envPath);
      } else {
        // Create an empty .env so key-store can write to it later
        fs.writeFileSync(envPath, "");
      }
    }
  } catch (e) {
    // Non-fatal: dotenv will just see an empty env
    console.error("Failed to bootstrap .env:", e.message);
  }
} else {
  envPath = path.join(__dirname, "../../.env");
}
require("dotenv").config({ path: envPath });
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-gpu-cache");
app.commandLine.appendSwitch("disable-http-cache");

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {

  app.quit();
  return;
}


const llm = require("../brain/llm");
const logger = require("../lib/logger");
const sttService = require("./speech/stt");

const mainWin = require("./windows/main-window");
const voiceWin = require("./windows/voice-window");
const setupWin = require("./windows/setup-window");
const backgroundWin = require("./windows/background-window");
const wakeWordService = require("./speech/wake-word");
const modelServer = require("./model-server");

const queryHandlers = require("./ipc/query-handlers");
const voiceHandlers = require("./ipc/voice-handlers");
const systemHandlers = require("./ipc/system-handlers");
const actionHandlers = require("./ipc/action-handlers");
const trayManager = require("./tray");
const connectivity = require("../lib/connectivity");

// When a second instance is launched, focus the existing main window.
app.on("second-instance", () => {
  const mw = mainWin.getWindow();
  if (mw && !mw.isDestroyed()) {
    if (mw.isMinimized()) mw.restore();
    mw.show();
    mw.focus();
  }
});

// Assign a unique session ID for this runtime instance so tokens like
// {{runtime.session_id}} resolve consistently within one session.
global.__venesa_session_id = `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function validateStandard() {
  try {
    const standard = require("../../venesa.standard.json");
    const { PROTOCOL_VERSION } = require("../brain/protocol");

    const errors = [];
    if (standard.compatibility?.protocolVersion && standard.compatibility.protocolVersion !== PROTOCOL_VERSION) {
      errors.push(`Protocol version mismatch: standard expects ${standard.compatibility.protocolVersion}, runtime has ${PROTOCOL_VERSION}`);
    }
    if (standard.compatibility?.minNodeVersion) {
      const reqParts = standard.compatibility.minNodeVersion.split('.');
      const curParts = process.versions.node.split('.');
      const reqMaj = Number(reqParts[0]) || 0;
      const reqMin = Number(reqParts[1]) || 0;
      const curMaj = Number(curParts[0]) || 0;
      const curMin = Number(curParts[1]) || 0;
      if (curMaj < reqMaj || (curMaj === reqMaj && curMin < reqMin)) {
        errors.push(`Node version ${process.versions.node} is below required ${standard.compatibility.minNodeVersion}`);
      }
    }

    if (errors.length > 0) {
      errors.forEach(e => logger.warn(`[standard] ${e}`));
    } else {
      logger.info(`[standard] Validated venesa.standard.json v${standard.version} OK`);
    }
  } catch (e) {
    logger.warn(`[standard] Could not validate standard: ${e.message}`);
  }
}


function getAssetsPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "assets");
  }
  return path.join(__dirname, "../../assets");
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "venesa-asset",
    privileges: { secure: true, supportFetchAPI: true, stream: true },
  },
]);

const startHidden = process.argv.includes("--hidden");

app.whenReady().then(async () => {
  // Validate platform standard before anything else runs
  validateStandard();

  // Net guard — must be first so all subsequent checks have current status
  connectivity.startMonitoring();

  protocol.handle("venesa-asset", (request) => {
    let filePath = request.url.replace("venesa-asset://", "");
    try {
      filePath = decodeURIComponent(filePath);
    } catch (e) {
      logger.warn(`[main] Failed to decode filePath "${filePath}": ${e.message}`);
    }

    const assetsPath = path.resolve(getAssetsPath());
    const fullPath = path.resolve(assetsPath, filePath);
    const relativePath = path.relative(assetsPath, fullPath);
    const isTraversal =
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath);

    if (isTraversal) {
      return new Response("Forbidden", { status: 403 });
    }

    return net.fetch(`file://${fullPath}`);
  });

  const s = require("../brain/settings").load();
  const autoStartEnabled = s.openAtLogin === true;

  app.setLoginItemSettings({
    openAtLogin: autoStartEnabled,
    path: app.getPath("exe"),
    args: autoStartEnabled ? ["--hidden"] : [],
  });

  const createMainWindow = () => {
    mainWin.createWindow(startHidden);
  };

  const showVoice = () => voiceWin.showVoiceWindow();
  const hideVoice = () => voiceWin.hideVoiceWindow();
  const getVoiceWindow = () => voiceWin.getWindow();

  const startWakeWord = () => {
    backgroundWin.startBackgroundWakeWordDetection(
      showVoice,
      voiceHandlers.captureScreenForVoice,
    );
  };

  // Pre-warm the Vosk model HTTP server immediately at app startup so it is
  // already running when the background window requests it. This removes the
  // server startup delay from the critical path and, combined with the fixed
  // port + Cache-Control headers in model-server.js, lets Chromium serve the
  // 40 MB model from its disk cache on every run after the first.
  if (wakeWordService.initialize()) {
    const modelTarGzPath = wakeWordService.getModelTarGzPath();
    if (modelTarGzPath && fs.existsSync(modelTarGzPath)) {
      modelServer
        .ensureRunning(modelTarGzPath)
        .then((port) =>
          logger.info(`[Main] Model server pre-warmed on port ${port}`),
        )
        .catch((err) =>
          logger.warn(`[Main] Model server pre-warm failed: ${err.message}`),
        );
    }
  }

  const { session } = require("electron");
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === "media") return callback(true);
      callback(false);
    },
  );

  // Register all IPC handlers before starting any windows so no event fires
  // before its handler is ready.
  queryHandlers.register();
  voiceHandlers.register(getVoiceWindow, hideVoice);
  systemHandlers.register({
    getSetupWindow: setupWin.getWindow,
    destroySetupWindow: setupWin.destroyWindow,
    createMainWindow,
    startWakeWord,
  });
  actionHandlers.register();

  // ── Tray icon ────────────────────────────────────────────────
  const settingsWindow = require("./windows/settings-window");
  trayManager.createTray({
    showMain: () => {
      const mw = mainWin.getWindow();
      if (mw && !mw.isDestroyed()) {
        mw.show();
        mw.focus();
      } else if (!llm.needsSetup()) {
        llm
          .initializeAPI()
          .then(() => createMainWindow())
          .catch(() => createMainWindow());
      }
    },
    showVoice: async () => {
      if (llm.needsSetup()) return;
      await voiceHandlers.captureScreenForVoice();
      showVoice();
    },
    showSettings: () => settingsWindow.toggle(),
  });

  if (llm.needsSetup()) {
    setupWin.createSetupWindow();
  } else {
    // Start background window (Vosk) immediately in parallel with LLM init
    // so the 20-40s WASM model load overlaps with the rest of startup.
    startWakeWord();

    try {
      await llm.initializeAPI();
    } catch (e) {
      // Non-fatal: user may not have API keys yet (skipped during setup).
      // The main window still opens so they can add keys via Settings.
      logger.error(`[Main] initializeAPI failed: ${e.message}`);
    }
    createMainWindow();
    sttService.initialize();
  }

  ipcMain.on("resize-window", (event, contentHeight) => {
    mainWin.handleResize(contentHeight);
  });

  // Mic button in main window opens voice mode
  ipcMain.on("open-voice-window", async () => {
    if (llm.needsSetup()) return;
    await voiceHandlers.captureScreenForVoice();
    showVoice();
  });

  globalShortcut.register("Alt+Space", () => {
    if (llm.needsSetup()) {
      const sw = setupWin.getWindow();
      if (sw && !sw.isDestroyed()) {
        sw.show();
        sw.focus();
      } else {
        setupWin.createSetupWindow();
      }
      return;
    }

    const mw = mainWin.getWindow();
    if (!mw || mw.isDestroyed()) {
      llm
        .initializeAPI()
        .then(() => createMainWindow())
        .catch((e) => {
          logger.error(`[Main] initializeAPI error: ${e.message}`);
          createMainWindow();
        });
      return;
    }

    if (mw.isVisible()) {
      mw.hide();
    } else {
      mainWin.showWindow();
    }
  });

  globalShortcut.register("Ctrl+Shift+V", async () => {
    if (llm.needsSetup()) return;
    await voiceHandlers.captureScreenForVoice();
    showVoice();
  });

  globalShortcut.register("Ctrl+,", () => {
    const settingsWindow = require("./windows/settings-window");
    settingsWindow.toggle();
  });

  globalShortcut.register("Alt+Escape", () => {
    const vw = voiceWin.getWindow();
    if (vw && !vw.isDestroyed() && vw.isVisible()) {
      hideVoice();
    }
  });
});

app.on("window-all-closed", () => { });

app.on("before-quit", () => {
  trayManager.destroyTray();
});
