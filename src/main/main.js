// Load environment variables from correct location
const { app, protocol, net } = require('electron');
const envPath = app.isPackaged
  ? require('path').join(process.resourcesPath, '.env')
  : require('path').join(__dirname, '../../.env');
require("dotenv").config({ path: envPath });

const {
  BrowserWindow,
  globalShortcut,
  ipcMain,
  shell,
  screen,
  desktopCapturer,
} = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const gemini = require("../core/llm-service.js");
const taskExecutor = require("../core/task-service.js");
const sttService = require("../core/stt-service.js");
const ttsService = require("../core/elevenlabs-service.js");
const wakeWordService = require("../core/wake-word-service.js");

// Get assets path based on environment
function getAssetsPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets');
  }
  return path.join(__dirname, '../../assets');
}

// Register custom protocol for assets before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'venesa-asset',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

let mainWindow;
let setupWindow;
let voiceWindow;
let backgroundAudioWindow = null;
const startHidden = process.argv.includes("--hidden");

const WINDOW_WIDTH = 680;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 500;

const ANIMATION_DURATION = 150;
const ANIMATION_STEPS = 12;
let animationInProgress = false;
let targetHeight = MIN_HEIGHT;
let animationTimeout = null;

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const cancelAnimation = () => {
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }
  animationInProgress = false;
};

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 420,
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
      preload: path.join(__dirname, "preload/main.preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  setupWindow.loadFile(path.join(__dirname, "../renderer/setup.window.html"));
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
      preload: path.join(__dirname, "preload/main.preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/main.window.html"));
  mainWindow.center();

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      mainWindow.show();
    }
  });

  mainWindow.on("blur", () => {
    cancelAnimation();
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

const http = require("http");
const url = require("url");

let modelServer = null;
let modelServerPort = 0;

function startModelServer(modelTarGzPath) {
  return new Promise((resolve) => {
    modelServer = http.createServer((req, res) => {
      console.log(`[ModelServer] Request: ${req.url}`);

      fs.readFile(modelTarGzPath, (err, data) => {
        if (err) {
          console.log(`[ModelServer] Error reading model: ${err.message}`);
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Content-Type", "application/gzip");
        res.setHeader("Content-Length", data.length);
        res.writeHead(200);
        res.end(data);
      });
    });

    const onError = (err) => {
      modelServer.removeListener('error', onError);
      reject(err);
    };
    modelServer.on('error', onError);

    modelServer.listen(0, "127.0.0.1", () => {
      modelServer.removeListener('error', onError);
      modelServerPort = modelServer.address().port;
      console.log(`[Main] Model server started on port ${modelServerPort}`);
      resolve(modelServerPort);
    });
  });
}

app.whenReady().then(async () => {
  // Register protocol handler for assets
  protocol.handle('venesa-asset', (request) => {
    const filePath = request.url.replace('venesa-asset://', '');
    const assetsPath = getAssetsPath();
    const fullPath = path.join(assetsPath, filePath);

    // Security: ensure the path stays within assets directory
    const normalizedPath = path.normalize(fullPath);
    if (!normalizedPath.startsWith(assetsPath)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(`file://${normalizedPath}`);
  });

  const settingsPath = path.join(os.homedir(), ".venesa-settings.json");
  let autoStartEnabled = false;
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      autoStartEnabled = settings.openAtLogin !== false;
    }
  } catch (e) {
    autoStartEnabled = true;
  }

  if (autoStartEnabled) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: app.getPath("exe"),
      args: ["--hidden"],
    });
  }

  await gemini.initializeAPI();

  if (gemini.needsSetup()) {
    createSetupWindow();
  } else {
    createWindow();

    sttService.initialize();

    startBackgroundWakeWordDetection();
  }

  const { session } = require("electron");
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback) => {
      if (permission === "media") {
        return callback(true);
      }

      callback(false);
    },
  );

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

      if (settings.openAtLogin !== undefined) {
        app.setLoginItemSettings({
          openAtLogin: settings.openAtLogin,
          path: app.getPath("exe"),
          args: ["--hidden"],
        });
      }

      event.sender.send("settings-saved", true);

      if (setupWindow && !setupWindow.isDestroyed()) {
        setupWindow.removeAllListeners("blur");
        setupWindow.removeAllListeners("close");
        setupWindow.destroy();
        setupWindow = null;
        if (!mainWindow || mainWindow.isDestroyed()) {
          createWindow();

          sttService.initialize();
          startBackgroundWakeWordDetection();
        }
      }
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
      if (!event.sender || event.sender.isDestroyed()) {
        console.warn(
          "[Main] send-to-gemini: Sender destroyed before processing",
        );
        return;
      }

      const rawResponse = await gemini.sendQuery(query);

      if (!event.sender || event.sender.isDestroyed()) {
        console.warn("[Main] send-to-gemini: Sender destroyed after query");
        return;
      }

      const { cleanResponse, results } =
        await taskExecutor.processResponse(rawResponse);

      if (!event.sender.isDestroyed()) {
        event.sender.send("gemini-response", cleanResponse);
      }

      if (results && results.length > 0) {
        for (const res of results) {
          if (event.sender.isDestroyed()) break;
          if (res.result) {
            event.sender.send("action-result", res.result);
          } else if (res.error) {
            event.sender.send("action-result", `Error: ${res.error}`);
          }
        }
      }
    } catch (error) {
      if (!event.sender || event.sender.isDestroyed()) return;
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
        result = await taskExecutor.performSearch(action.params.query);
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
        const safeAppIdPattern = /^[a-zA-Z0-9._!\-]+$/;
        if (!safeAppIdPattern.test(appInfo.appId)) {
          console.error("Invalid appId format:", appInfo.appId);
          return;
        }
        const { execFile } = require("child_process");

        execFile("explorer.exe", [`shell:AppsFolder\\${appInfo.appId}`], {
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

  ipcMain.on("open-external-url", (event, url) => {
    if (url && (url.startsWith("http://") || url.startsWith("https://"))) {
      shell.openExternal(url);
    }
  });

  const animateWindowHeight = (fromHeight, toHeight) => {
    cancelAnimation();

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const bounds = mainWindow.getBounds();
    const heightDiff = toHeight - fromHeight;
    const stepDuration = ANIMATION_DURATION / ANIMATION_STEPS;
    let currentStep = 0;

    const animate = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        cancelAnimation();
        return;
      }

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

      if (
        currentStep < ANIMATION_STEPS &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        animationTimeout = setTimeout(animate, stepDuration);
      } else {
        animationInProgress = false;
        animationTimeout = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: WINDOW_WIDTH,
            height: toHeight,
          });
        }
      }
    };

    animationInProgress = true;
    animate();
  };

  ipcMain.on("resize-window", (event, contentHeight) => {
    if (mainWindow) {
      const newHeight = Math.max(
        MIN_HEIGHT,
        Math.min(Math.round(contentHeight), MAX_HEIGHT),
      );
      targetHeight = newHeight;

      const [currentWidth, currentHeight] = mainWindow.getSize();
      if (currentHeight !== newHeight) {
        animateWindowHeight(currentHeight, newHeight);
      }
    }
  });

  function closeAllFeatureWindows() {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    }
  }

  function createVoiceWindow() {
    if (voiceWindow && !voiceWindow.isDestroyed()) return;

    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    voiceWindow = new BrowserWindow({
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
        preload: path.join(__dirname, "preload/voice.preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    voiceWindow.loadFile(path.join(__dirname, "../renderer/voice.window.html"));

    voiceWindow.webContents.on("render-process-gone", (event, details) => {
      console.error("[VoiceWindow] Renderer crashed:", details.reason);

      voiceWindow = null;
    });

    voiceWindow.webContents.on("crashed", (event, killed) => {
      console.error("[VoiceWindow] WebContents crashed, killed:", killed);
      voiceWindow = null;
    });

    voiceWindow.on("blur", () => {
      setTimeout(() => {
        if (
          voiceWindow &&
          !voiceWindow.isDestroyed() &&
          voiceWindow.isVisible()
        ) {
          console.log("[Main] hideVoiceWindow triggered by: blur event");
          hideVoiceWindow();
        }
      }, 100);
    });

    voiceWindow.on("closed", () => {
      voiceWindow = null;
    });
  }

  function showVoiceWindow() {
    if (!voiceWindow || voiceWindow.isDestroyed()) {
      createVoiceWindow();
    }

    closeAllFeatureWindows();

    let startListeningSent = false;

    const safeSend = (channel, data) => {
      try {
        if (
          voiceWindow &&
          !voiceWindow.isDestroyed() &&
          voiceWindow.webContents &&
          !voiceWindow.webContents.isDestroyed()
        ) {
          voiceWindow.webContents.send(channel, data);
        }
      } catch (err) { }
    };

    sttService.start((type, text) => {
      if (type === "text") {
        safeSend("stt-result", text);
      } else if (type === "partial") {
        safeSend("stt-partial-result", text);
      }
    });

    const sendStartListening = () => {
      if (!startListeningSent) {
        startListeningSent = true;
        safeSend("start-listening");
      }
    };

    if (voiceWindow.webContents.isLoading()) {
      voiceWindow.webContents.once("did-finish-load", sendStartListening);
    } else {
      sendStartListening();
    }

    voiceWindow.show();
    voiceWindow.focus();
    console.log("[Main] Voice window shown and focused");
  }

  function hideVoiceWindow() {
    const safeSendToVoice = (channel, data) => {
      try {
        if (
          voiceWindow &&
          !voiceWindow.isDestroyed() &&
          voiceWindow.webContents &&
          !voiceWindow.webContents.isDestroyed()
        ) {
          voiceWindow.webContents.send(channel, data);
        }
      } catch (e) { }
    };

    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.hide();
      sttService.stop();

      safeSendToVoice("auto-close-voice");

      wakeWordService.resume();
      if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
        try {
          if (
            backgroundAudioWindow.webContents &&
            !backgroundAudioWindow.webContents.isDestroyed()
          ) {
            backgroundAudioWindow.webContents.send("resume-detection");
          }
        } catch (e) { }
      }
    }
  }

  ipcMain.on("close-voice-window", () => {
    console.log("[Main] hideVoiceWindow triggered by: close-voice-window IPC");
    hideVoiceWindow();
  });
  ipcMain.on("auto-close-voice", () => {
    console.log("[Main] hideVoiceWindow triggered by: auto-close-voice IPC");
    hideVoiceWindow();
  });

  ipcMain.on("open-voice-window", () => {
    showVoiceWindow();
  });

  createVoiceWindow();

  let cachedScreenCapture = null;

  ipcMain.on("voice-window-ready", () => { });

  function needsVisualContext(query) {
    if (!query) return false;

    const visualKeywords = [
      "show",
      "see",
      "look",
      "screen",
      "display",
      "what is",
      "what's",
      "read",
      "visible",
      "image",
      "picture",
      "window",
      "find on",
      "what do you see",
      "describe",
      "tell me about",
      "on my screen",
      "this",
      "that",
      "here",
      "there",
    ];

    const lowerQuery = query.toLowerCase().trim();
    return visualKeywords.some((keyword) => lowerQuery.includes(keyword));
  }

  ipcMain.on("voice-query", async (event, payload) => {
    try {
      let imageToSend = null;

      if (needsVisualContext(payload.query)) {
        imageToSend = payload.image || cachedScreenCapture;
      }

      let finalQuery = payload.query;

      if (payload.previousResults && Array.isArray(payload.previousResults)) {
        const listStr = payload.previousResults
          .map((r) => `${r.index}. ${r.name} (${r.type})`)
          .join(", ");
        finalQuery = `[CONTEXT: User is viewing these search results: ${listStr}] User said: "${payload.query}"
        
        INSTRUCTION: 
        1. If user selects an item (by number like "one", "2", or name like "open resume", or position "the first one"), return [action: openFile, filePath: <path_from_list>] or [action: launchApplication, appName: <name_from_list>].
        2. If user says "cancel" or "close", return "No Problem!" and NO action.
        3. If user asks something new (e.g. "what is the weather"), ignore the list and answer the new question.
        
        Hidden paths data for your reference:
        ${JSON.stringify(payload.previousResults.map((r) => ({ index: r.index, path: r.path })))}`;
      }

      const rawResponse = await gemini.sendQuery(
        finalQuery,
        imageToSend,
        "voice",
      );
      console.log("[Main] Voice query:", payload.query);
      console.log("[Main] Raw Gemini response:", rawResponse);

      const { cleanResponse, results } =
        await taskExecutor.processResponse(rawResponse);
      console.log("[Main] Parsed results:", JSON.stringify(results));

      let finalResponse = cleanResponse.replace(/\[NEED_SCREEN\]/g, "").trim();

      let hasSearchResults = false;
      let searchResultData = null;
      let shouldListenAgain = false;

      let feedback = [];
      if (results && results.length > 0) {
        for (const res of results) {
          if (res.actionName === "searchFiles" && res.result) {
            try {
              searchResultData =
                typeof res.result === "string"
                  ? JSON.parse(res.result)
                  : res.result;
              const hasItems =
                (searchResultData.apps?.length || 0) +
                (searchResultData.files?.length || 0) +
                (searchResultData.folders?.length || 0) >
                0;
              if (hasItems) hasSearchResults = true;
              else feedback.push("I couldn't find any matching files or apps.");
            } catch (e) {
              console.error("[Main] Search parse error:", e);
            }
          } else if (res.actionName === "getSystemInfo" && res.result) {
            try {
              const info =
                typeof res.result === "string"
                  ? JSON.parse(res.result)
                  : res.result;
              if (info && !info.error) {
                feedback.push(
                  `CPU is at ${info.cpu}, RAM is ${info.ramUsed} of ${info.ramTotal}GB, battery is at ${info.battery}, and uptime is ${info.uptime}.`,
                );
              }
            } catch (e) { }
          } else if (res.actionName === "getTime" && res.result) {
            try {
              const timeInfo =
                typeof res.result === "string"
                  ? JSON.parse(res.result)
                  : res.result;
              if (timeInfo && timeInfo.full) {
                feedback.push(`It's ${timeInfo.full}.`);
              }
            } catch (e) { }
          } else if (res.actionName === "runPowerShell" && res.result) {
            try {
              const psResult =
                typeof res.result === "string"
                  ? res.result
                  : JSON.stringify(res.result);
              if (psResult && !psResult.includes("error")) {
                feedback.push(psResult);
              }
            } catch (e) { }
          } else if (res.actionName === "systemControl" && res.result) {
            if (res.result.toLowerCase().includes("error"))
              feedback.push(`System control failed: ${res.result}`);
          } else if (res.actionName === "listen") {
            shouldListenAgain = true;
          }
        }
      }

      if (feedback.length > 0) {
        finalResponse = (finalResponse + " " + feedback.join(" ")).trim();
      }

      if (hasSearchResults && searchResultData) {
        const apps = searchResultData.apps || [];
        const files = searchResultData.files || [];
        const folders = searchResultData.folders || [];
        const totalCount = apps.length + files.length + folders.length;

        const allResults = [];
        apps.forEach((app) =>
          allResults.push({ name: app.name, type: "app", data: app }),
        );
        folders.forEach((folder) =>
          allResults.push({
            name: path.basename(folder),
            type: "folder",
            data: folder,
          }),
        );
        files.forEach((file) =>
          allResults.push({
            name: path.basename(file),
            type: "file",
            data: file,
          }),
        );
        const displayResults = allResults.slice(0, 5);

        if (!event.sender.isDestroyed()) {
          event.sender.send("voice-search-results", {
            results: displayResults,
            totalCount,
            waitingForSelection: true,
          });
        }

        if (totalCount > 0) {
          finalResponse = `I found ${totalCount} match${totalCount > 1 ? "es" : ""}. Which one would you like?`;
          shouldListenAgain = true;
        } else {
          finalResponse = "I couldn't find any matching files or apps.";
        }
      }

      if (!finalResponse || finalResponse.trim() === "") {
        finalResponse = "Done.";
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: finalResponse,
          audio: null,
        });
      }

      const cancelRegex = /\b(cancelled|closing|cancel)\b|no problem!?/i;
      if (cancelRegex.test(finalResponse)) {
        shouldListenAgain = false;
        setTimeout(() => {
          if (voiceWindow && !voiceWindow.isDestroyed()) {
            hideVoiceWindow();
          }
        }, 1500);
      }

      if (shouldListenAgain && !event.sender.isDestroyed()) {
        event.sender.send("continue-listening");
      }

      if (ttsService.isAvailable() && finalResponse.length > 0) {
        ttsService
          .synthesizeToDataURL(finalResponse)
          .then((audioDataUrl) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("voice-audio-ready", audioDataUrl);
            }
          })
          .catch((ttsError) => { });
      }
    } catch (error) {
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: `Error: ${error}`,
          audio: null,
        });
      }
    }
  });

  ipcMain.on("audio-data", (event, audioBuffer) => {
    if (sttService && sttService.isListening) {
      sttService.feedAudio(Buffer.from(audioBuffer));
    }
  });

  ipcMain.on("restart-stt", (event) => {
    console.log("[Main] Restarting STT service for continued listening");

    const safeSend = (channel, data) => {
      try {
        if (
          voiceWindow &&
          !voiceWindow.isDestroyed() &&
          voiceWindow.webContents &&
          !voiceWindow.webContents.isDestroyed()
        ) {
          voiceWindow.webContents.send(channel, data);
        }
      } catch (err) { }
    };

    sttService.start((type, text) => {
      if (type === "text") {
        safeSend("stt-result", text);
      } else if (type === "partial") {
        safeSend("stt-partial-result", text);
      }
    });
  });

  ipcMain.on("voice-file-action", async (event, payload) => {
    try {
      if (
        !payload ||
        !payload.selectedItem ||
        typeof payload.selectedItem !== "object"
      ) {
        console.error("[Main] Invalid voice-file-action payload");
        if (!event.sender.isDestroyed()) {
          event.sender.send("voice-response", {
            text: "Error: Invalid selection data",
            audio: null,
          });
        }
        return;
      }

      const { originalQuery, selectedItem } = payload;
      if (process.env.DEBUG) {
        console.log("[Main] voice-file-action received");
      }

      const contextQuery = `The user said "${originalQuery}" and selected a ${selectedItem.type} named "${selectedItem.name}". The full path is "${selectedItem.path}". Based on the original request, what action should I take? If the user was searching for something to open/launch, open it. If they wanted to find/locate it, show it in the folder. Respond with the action to take.`;

      const rawResponse = await gemini.sendQuery(contextQuery, null, "voice");
      const { cleanResponse, results } =
        await taskExecutor.processResponse(rawResponse);

      let actionTaken = false;
      let finalResponse = cleanResponse;

      if (results && results.length > 0) {
        for (const res of results) {
          if (
            res.actionName === "openFile" ||
            res.actionName === "launchApplication"
          ) {
            actionTaken = true;
            break;
          }
        }
      }

      if (!actionTaken) {
        let openError = "";
        if (selectedItem.type === "app") {
          if (selectedItem.data && selectedItem.data.path) {
            openError = await shell.openPath(selectedItem.data.path);
          } else {
            try {
              const launchResult = await taskExecutor.launchApplication(
                selectedItem.name,
              );

              if (
                launchResult &&
                (launchResult.startsWith("Error") ||
                  launchResult.startsWith("Could not"))
              ) {
                openError = launchResult;
              }
            } catch (err) {
              openError = err.message || "Failed to launch application";
            }
          }
          if (!openError) finalResponse = `Opening ${selectedItem.name}.`;
        } else if (selectedItem.type === "folder") {
          const folderPath = path.isAbsolute(selectedItem.path)
            ? selectedItem.path
            : path.join(os.homedir(), selectedItem.path);
          openError = await shell.openPath(folderPath);
          if (!openError) finalResponse = `Opening ${selectedItem.name}.`;
        } else if (selectedItem.type === "file") {
          const filePath = path.isAbsolute(selectedItem.path)
            ? selectedItem.path
            : path.join(os.homedir(), selectedItem.path);
          openError = await shell.openPath(filePath);
          if (!openError) finalResponse = `Opening ${selectedItem.name}.`;
        }

        if (openError) {
          console.error("[Main] Failed to open path:", openError);
          finalResponse = `I couldn't open that item.`;
        }
      }

      if (!event.sender.isDestroyed()) {
        event.sender.send("action-complete");
        event.sender.send("voice-response", {
          text: finalResponse,
          audio: null,
        });
      }

      if (ttsService.isAvailable() && finalResponse.length > 0) {
        ttsService
          .synthesizeToDataURL(finalResponse)
          .then((audioDataUrl) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("voice-audio-ready", audioDataUrl);
            }
          })
          .catch((ttsError) => { });
      }
    } catch (error) {
      console.error("[Main] voice-file-action error:", error);
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: `Error: ${error.message}`,
          audio: null,
        });
      }
    }
  });

  ipcMain.on("voice-audio", async (event, data) => {
    try {
      const { buffer, mimeType } = data;
      const audioBuffer = Buffer.from(buffer);

      const transcribedText = await ttsService.transcribe(audioBuffer, {
        filename: "audio.webm",
        contentType: mimeType || "audio/webm",
      });

      console.log("[Main] STT result:", transcribedText);
      event.sender.send("stt-result", transcribedText);
    } catch (error) {
      console.error("[Main] Voice audio processing error:", error);
      event.sender.send("stt-result", "");
    }
  });

  ipcMain.on("capture-region", async (event, rect) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });

      if (sources.length > 0) {
        const thumbnail = sources[0].thumbnail;

        const imageData = thumbnail.toDataURL();
        event.sender.send("screen-captured", imageData);
      }
    } catch (error) {
      console.error("Region capture failed:", error);
    }
  });

  globalShortcut.register("Ctrl+Shift+V", async () => {
    if (gemini.needsSetup()) return;
    await captureScreenForVoice();
    showVoiceWindow();
  });

  globalShortcut.register("Escape", () => {
    if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
      console.log("[Main] hideVoiceWindow triggered by: Escape key");
      hideVoiceWindow();
    }
  });

  function createBackgroundAudioWindow() {
    if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) return;

    backgroundAudioWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload/background.preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    backgroundAudioWindow.loadFile(
      path.join(__dirname, "../renderer/background.window.html"),
    );

    backgroundAudioWindow.on("closed", () => {
      backgroundAudioWindow = null;
    });
  }

  function startBackgroundWakeWordDetection() {
    if (!wakeWordService.initialize()) {
      console.error(
        "[Main] Wake word models not found, skipping wake word detection",
      );
      return;
    }

    createBackgroundAudioWindow();

    // Remove existing listeners to prevent duplicate handlers on repeated calls
    ipcMain.removeAllListeners("wake-word-detected");
    ipcMain.removeAllListeners("background-audio-ready");
    ipcMain.removeAllListeners("get-model-paths");
    ipcMain.removeAllListeners("console-log");
    ipcMain.removeAllListeners("console-error");
    ipcMain.removeAllListeners("resume-failed");

    ipcMain.on("wake-word-detected", (event, data) => {
      console.log("[Main] Wake word detected, opening voice window");

      wakeWordService.pause();
      if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
        backgroundAudioWindow.webContents.send("pause-detection");
      }

      showVoiceWindow();
      captureScreenForVoice();

      if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
        backgroundAudioWindow.webContents.send("play-acknowledgment");
      }
    });

    wakeWordService.start(() => { });

    ipcMain.on("background-audio-ready", () => {
      console.log("[Main] Background audio window ready");
    });

    ipcMain.on("get-model-paths", async (event) => {
      const modelDirPath = wakeWordService.getVoskModelPath();
      if (modelDirPath && !event.sender.isDestroyed()) {
        const modelTarGzPath = path.join(
          path.dirname(modelDirPath),
          "vosk-model.tar.gz",
        );

        // Check if model file exists
        if (!fs.existsSync(modelTarGzPath)) {
          console.error(`[Main] Model file not found: ${modelTarGzPath}`);
          return;
        }

        if (!modelServer) {
          await startModelServer(modelTarGzPath);
        }

        const modelUrl = `http://127.0.0.1:${modelServerPort}/model.tar.gz`;
        console.log(`[Main] Serving model from: ${modelTarGzPath}`);
        event.sender.send("model-path", modelUrl);
      }
    });

    ipcMain.on("console-log", (event, msg) => {
      console.log(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on("console-error", (event, msg) => {
      console.error(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on("resume-failed", () => {
      console.error(
        "[Main] Wake word detection failed to resume - mic may be in use",
      );
    });
  }

  async function captureScreenForVoice() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1280, height: 720 },
      });

      if (sources.length > 0) {
        cachedScreenCapture = sources[0].thumbnail.toDataURL();
      }
    } catch (error) {
      cachedScreenCapture = null;
      console.error("[Main] Screen capture failed:", error);
    }
  }

  const handleCapture = async (event) => {
    try {
      if (!cachedScreenCapture) {
        await captureScreenForVoice();
      }

      if (cachedScreenCapture) {
        if (!event.sender.isDestroyed()) {
          event.sender.send("screen-captured", cachedScreenCapture);
        }
      }
    } catch (error) {
      console.error("[Main] Handle capture error:", error);
    }
  };

  ipcMain.on("capture-screen", handleCapture);
});

let _startBackgroundWakeWordDetection = null;

module.exports = {
  startBackgroundWakeWordDetection: () => {
    if (_startBackgroundWakeWordDetection) {
      _startBackgroundWakeWordDetection();
    }
  },
};
