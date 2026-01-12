const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  screen,
  desktopCapturer,
} = require("electron");
const path = require("path");
const os = require("os");
const gemini = require("./gemini-api.js");
const taskExecutor = require("./task-executor.js");

let mainWindow;
let setupWindow;
let voiceWindow;
const startHidden = process.argv.includes("--hidden");

const WINDOW_WIDTH = 680;
const MIN_HEIGHT = 53;
const MAX_HEIGHT = 470;

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 450,
    height: 550,
    frame: false,
    transparent: false,
    backgroundColor: "#e7e7fb",
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWindow.loadFile("setup.html");
  setupWindow.center();

  setupWindow.once("ready-to-show", () => {
    setupWindow.show();
  });

  setupWindow.on("blur", () => {
    if (setupWindow && !setupWindow.isDestroyed()) {
      setupWindow.hide();
    }
  });

  setupWindow.on("close", (e) => {
    if (setupWindow && !setupWindow.isDestroyed()) {
      e.preventDefault();
      setupWindow.hide();
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: MIN_HEIGHT,
    frame: false,
    transparent: true,

    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.center();

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      mainWindow.show();
    }
  });

  mainWindow.on("blur", () => {
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: WINDOW_WIDTH,
      height: MIN_HEIGHT,
    });
    mainWindow.hide();
  });

  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

app.whenReady().then(() => {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath("exe"),
    args: ["--hidden"],
  });

  if (gemini.needsSetup()) {
    createSetupWindow();
  } else {
    gemini.initializeAPI();
    createWindow();
  }

  globalShortcut.register("Alt+Space", () => {
    if (gemini.needsSetup()) {
      if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.show();
        setupWindow.focus();
      } else {
        createSetupWindow();
      }
      return;
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      gemini.initializeAPI();
      createWindow();
      return;
    }

    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      const cursorPoint = screen.getCursorScreenPoint();
      const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
      const { x, y, width, height } = currentDisplay.workArea;
      const windowX = Math.round(x + (width - WINDOW_WIDTH) / 2);
      const windowY = Math.round(y + height * 0.2);

      mainWindow.setBounds({
        x: windowX,
        y: windowY,
        width: WINDOW_WIDTH,
        height: MIN_HEIGHT,
      });

      mainWindow.show();
      mainWindow.focus();
      mainWindow.webContents.send("focus-input");
    }
  });

  ipcMain.on("save-settings", (event, settings) => {
    event.preventDefault();
    const success = gemini.saveSettings(settings);
    if (success) {
      gemini.initializeAPI();
      event.sender.send("settings-saved", true);
      if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.removeAllListeners("blur");
        setupWindow.removeAllListeners("close");
        setupWindow.destroy();
        setupWindow = null;
      }
      createWindow();
    } else {
      event.sender.send("settings-saved", false);
    }
  });

  ipcMain.on("get-settings", (event) => {
    const settings = gemini.getSettings();
    event.sender.send("current-settings", settings);
  });

  ipcMain.on("open-settings", (event) => {
    event.sender.send("show-settings-panel", gemini.getSettings());
  });

  ipcMain.on("close-settings", (event) => {
    event.sender.send("hide-settings-panel");
  });

  ipcMain.on("send-to-gemini", async (event, query) => {
    try {
      const response = await gemini.sendQuery(query);
      event.sender.send("gemini-response", response);
    } catch (error) {
      event.sender.send("gemini-response", `Error: ${error}`);
    }
  });

  ipcMain.on("perform-action", async (event, action) => {
    try {
      let result;
      if (action.actionName === "launchApplication") {
        result = await taskExecutor.launchApplication(action.params.appName);
      } else if (action.actionName === "openFile") {
        result = await taskExecutor.openFile(action.params.filePath);
      } else if (action.actionName === "searchFiles") {
        const [apps, filesJson, foldersJson] = await Promise.all([
          taskExecutor.searchApplications(action.params.query),
          taskExecutor.searchFiles(action.params.query),
          taskExecutor.searchFolders(action.params.query),
        ]);

        let files = [];
        let folders = [];
        try {
          files = JSON.parse(filesJson);
        } catch (e) {
          files = [];
        }
        try {
          folders = JSON.parse(foldersJson);
        } catch (e) {
          folders = [];
        }

        if (
          (!apps || apps.length === 0) &&
          (!files || files.length === 0) &&
          (!folders || folders.length === 0)
        ) {
          result = JSON.stringify({
            notFound: true,
            query: action.params.query,
          });
        } else {
          result = JSON.stringify({
            apps: apps || [],
            files: files || [],
            folders: folders || [],
          });
        }
      }
      event.sender.send("action-result", result);
    } catch (error) {
      event.sender.send("action-result", `Error: ${error}`);
    }
  });

  ipcMain.on("launch-app", async (event, appInfo) => {
    try {
      if (appInfo.type === "shortcut" && appInfo.path) {
        await shell.openPath(appInfo.path);
      } else if (appInfo.appId) {
        const { exec } = require("child_process");
        exec(`explorer.exe shell:AppsFolder\\${appInfo.appId}`, {
          windowsHide: true,
        });
      } else {
        await taskExecutor.launchApplication(appInfo.name);
      }
    } catch (error) {
      console.error("Failed to launch app:", error);
    }
  });

  ipcMain.on("open-file", (event, filePath) => {
    let fullPath = filePath;
    if (!path.isAbsolute(filePath)) {
      fullPath = path.join(os.homedir(), filePath);
    }
    shell.openPath(fullPath).catch(() => { });
  });

  ipcMain.on("show-file-in-folder", (event, filePath) => {
    let fullPath = filePath;
    if (!path.isAbsolute(filePath)) {
      fullPath = path.join(os.homedir(), filePath);
    }
    shell.showItemInFolder(fullPath);
  });

  ipcMain.on("open-folder", (event, folderPath) => {
    let fullPath = folderPath;
    if (!path.isAbsolute(folderPath)) {
      fullPath = path.join(os.homedir(), folderPath);
    }
    shell.openPath(fullPath).catch(() => { });
  });

  // Open URLs in external browser
  ipcMain.on("open-external-url", (event, url) => {
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      shell.openExternal(url);
    }
  });

  const ANIMATION_DURATION = 150;
  const ANIMATION_STEPS = 12;

  let animationInProgress = false;
  let targetHeight = MIN_HEIGHT;
  let animationTimeout = null;

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  const animateWindowHeight = (fromHeight, toHeight) => {
    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }

    const bounds = mainWindow.getBounds();
    const heightDiff = toHeight - fromHeight;
    const stepDuration = ANIMATION_DURATION / ANIMATION_STEPS;
    let currentStep = 0;

    const animate = () => {
      currentStep++;
      const progress = currentStep / ANIMATION_STEPS;
      const easedProgress = easeOutCubic(progress);
      const newHeight = Math.round(fromHeight + heightDiff * easedProgress);

      mainWindow.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: WINDOW_WIDTH,
        height: newHeight,
      });

      if (currentStep < ANIMATION_STEPS && mainWindow) {
        animationTimeout = setTimeout(animate, stepDuration);
      } else {
        animationInProgress = false;
        mainWindow.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: WINDOW_WIDTH,
          height: toHeight,
        });
      }
    };

    animationInProgress = true;
    animate();
  };

  ipcMain.on("resize-window", (event, contentHeight) => {
    if (mainWindow) {
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(Math.round(contentHeight), MAX_HEIGHT)
      );
      targetHeight = newHeight;

      const [currentWidth, currentHeight] = mainWindow.getSize();
      if (currentHeight !== newHeight) {
        animateWindowHeight(currentHeight, newHeight);
      }
    }
  });

  // === WINDOW MANAGEMENT HELPERS ===
  function closeAllFeatureWindows() {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    }
    if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
      voiceWindow.hide();
    }
    // Setup window usually stays until done, but if strictly one feature:
    // setupWindow is special, we leave it alone if it's strictly for setup.
  }

  // === VOICE WINDOW ===
  const VOICE_WINDOW_SIZE = 380;

  function createVoiceWindow() {
    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const { x, y, width, height } = currentDisplay.workArea;

    voiceWindow = new BrowserWindow({
      x: x,
      y: y,
      width: width,
      height: height,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "voice-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    voiceWindow.loadFile("voice.html");

    voiceWindow.once("ready-to-show", () => {
      closeAllFeatureWindows(); // Policy: Only one window open
      voiceWindow.show();
      voiceWindow.focus();
    });

    // Clicking outside (blur) closes the window
    voiceWindow.on("blur", () => {
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        voiceWindow.hide();
      }
    });

    voiceWindow.on("closed", () => {
      voiceWindow = null;
    });
  }

  function showVoiceWindow() {
    if (!voiceWindow || voiceWindow.isDestroyed()) {
      createVoiceWindow();
    } else {
      const cursorPoint = screen.getCursorScreenPoint();
      const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
      const { x, y, width, height } = currentDisplay.workArea;

      voiceWindow.setBounds({
        x: x,
        y: y,
        width: width,
        height: height,
      });

      closeAllFeatureWindows(); // Policy: Only one window open
      voiceWindow.show();
      voiceWindow.focus();
    }
  }

  // Voice window IPC handlers
  ipcMain.on("close-voice-window", () => {
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.hide();
    }
  });

  ipcMain.on("open-voice-window", () => {
    if (gemini.needsSetup()) return;
    showVoiceWindow();
  });

  ipcMain.on("voice-window-ready", () => {
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.webContents.send("start-listening");
    }
  });

  ipcMain.on("voice-query", async (event, payload) => {
    try {
      const response = await gemini.sendQuery(payload.query, payload.image);
      event.sender.send("voice-response", response);
    } catch (error) {
      event.sender.send("voice-response", `Error: ${error}`);
    }
  });

  // Screen capture - Always full screen now
  const handleCapture = async (event) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 } // Reasonable quality
      });

      if (sources.length > 0) {
        // Find screen with cursor or just primary?
        // Let's use the first one for now, or the one matching current display if possible.
        // Electron desktopCapturer usually returns 'Screen 1', 'Screen 2'.
        const thumbnail = sources[0].thumbnail;
        const imageData = thumbnail.toDataURL();
        event.sender.send("screen-captured", imageData);
      }
    } catch (error) {
      console.error("Screen capture failed:", error);
    }
  };

  ipcMain.on("capture-region", async (event, rect) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });

      if (sources.length > 0) {
        const thumbnail = sources[0].thumbnail;
        // For now, send the full screen - region cropping would need canvas
        const imageData = thumbnail.toDataURL();
        event.sender.send("screen-captured", imageData);
      }
    } catch (error) {
      console.error("Region capture failed:", error);
    }
  });

  // Global shortcut for voice (Ctrl+Shift+V for testing, wake word later)
  globalShortcut.register("Ctrl+Shift+V", () => {
    if (gemini.needsSetup()) return;
    showVoiceWindow();
  });

  // Escape to close voice window
  globalShortcut.register("Escape", () => {
    if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
      voiceWindow.hide();
    }
  });
});
