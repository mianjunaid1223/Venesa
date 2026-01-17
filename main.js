// Load environment variables first
require('dotenv').config();

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
const gemini = require("./services/llm-service.js");
const taskExecutor = require("./services/task-service.js");
const sttService = require("./services/stt-service.js");
const ttsService = require("./services/elevenlabs-service.js");
const wakeWordService = require("./services/wake-word-service.js");

let mainWindow;
let setupWindow;
let voiceWindow;
let backgroundAudioWindow = null; // Hidden window for background mic
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

app.whenReady().then(async () => {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath("exe"),
    args: ["--hidden"],
  });

  // Initialize API key pool at startup (no validation - validate lazily on first use)
  gemini.initializeAPI();

  if (gemini.needsSetup()) {
    createSetupWindow();
  } else {
    createWindow();

    // Initialize STT service
    sttService.initialize();

    // Start background wake word detection
    startBackgroundWakeWordDetection();
  }

  // Auto-grant permissions (microphone)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const url = webContents.getURL();
    if (permission === 'media') {
      // Approve microphone access
      return callback(true);
    }
    // Verify specific permissions if needed
    if (permission === 'notifications' || permission === 'fullscreen') {
      return callback(true);
    }
    callback(false);
  });

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
  }

  // === VOICE WINDOW ===
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
        preload: path.join(__dirname, "voice-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    voiceWindow.loadFile("voice.html");

    // Clicking outside (blur) or Esc hides the window
    voiceWindow.on("blur", () => {
      // Small delay to prevent accidental closure on activation
      setTimeout(() => {
        if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
          hideVoiceWindow();
        }
      }, 500);
    });

    voiceWindow.on("closed", () => {
      voiceWindow = null;
    });
  }

  function showVoiceWindow() {
    if (!voiceWindow) createVoiceWindow();

    closeAllFeatureWindows();
    voiceWindow.show();
    voiceWindow.focus();

    // Start STT service
    sttService.start((type, text) => {
      if (voiceWindow && !voiceWindow.isDestroyed()) {
        if (type === 'text') {
          voiceWindow.webContents.send('stt-result', text);
        } else if (type === 'partial') {
          voiceWindow.webContents.send('stt-partial-result', text);
        } else if (type === 'ready') {
          voiceWindow.webContents.send('start-listening');
        }
      }
    });

    // Tell renderer to start mic
    voiceWindow.webContents.send('start-listening');
  }

  function hideVoiceWindow() {
    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.hide();
      sttService.stop();
      wakeWordService.resume();
      // Resume background audio mic
      if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
        backgroundAudioWindow.webContents.send("resume-detection");
      }
    }
  }

  // IPC Handlers
  ipcMain.on("close-voice-window", () => { hideVoiceWindow(); });
  ipcMain.on("auto-close-voice", () => { hideVoiceWindow(); });
  ipcMain.on("open-voice-window", () => { showVoiceWindow(); });

  // Warm up the window at startup
  createVoiceWindow();


  // Cache for screen capture
  let cachedScreenCapture = null;

  // Capture screen BEFORE showing voice window


  ipcMain.on("voice-window-ready", () => {
    // This IPC handler is now largely redundant as STT starts with showVoiceWindow
    // but can be kept for any other 'ready' signals if needed.
    // The actual STT start logic is now in showVoiceWindow().
  });

  // Helper: Determine if query needs visual context
  function needsVisualContext(query) {
    if (!query) return false;

    const visualKeywords = [
      'show', 'see', 'look', 'screen', 'display', 'what is', 'what\'s',
      'read', 'visible', 'image', 'picture', 'window', 'find on',
      'what do you see', 'describe', 'tell me about', 'on my screen',
      'this', 'that', 'here', 'there'
    ];

    const lowerQuery = query.toLowerCase().trim();
    return visualKeywords.some(keyword => lowerQuery.includes(keyword));
  }

  ipcMain.on("voice-query", async (event, payload) => {
    try {
      // OPTIMIZATION: Only send image if query suggests visual context is needed
      // This saves 8-10 seconds for simple queries like "what time is it"
      let imageToSend = null;

      if (needsVisualContext(payload.query)) {
        // Visual query detected - use cached screen or provided image
        imageToSend = payload.image || cachedScreenCapture;
      }
      // else: Simple query, no image needed - Gemini text-only is 5-10x faster

      // Single Gemini request (with or without image) - mode='voice'
      const response = await gemini.sendQuery(payload.query, imageToSend, 'voice');

      // Clean up any [NEED_SCREEN] tags
      const cleanResponse = response.replace(/\[NEED_SCREEN\]/g, '').trim();

      // Send text response IMMEDIATELY - don't wait for TTS
      event.sender.send("voice-response", {
        text: cleanResponse,
        audio: null // Will be sent separately
      });

      // Synthesize TTS in parallel - send when ready
      if (ttsService.isAvailable() && cleanResponse.length > 0) {
        ttsService.synthesizeToDataURL(cleanResponse)
          .then(audioDataUrl => {
            // Check if sender still exists before sending audio
            if (!event.sender.isDestroyed()) {
              event.sender.send("voice-audio-ready", audioDataUrl);
            }
          })
          .catch(ttsError => {
            // Silent fail - TTS is not critical
          });
      }
    } catch (error) {
      event.sender.send("voice-response", { text: `Error: ${error}`, audio: null });
    }
  });

  // Handle audio data from renderer (Web Audio API)
  ipcMain.on("audio-data", (event, audioBuffer) => {
    if (sttService && sttService.isListening) {
      // audioBuffer is an ArrayBuffer of Int16 PCM data
      sttService.feedAudio(Buffer.from(audioBuffer));
    }
  });

  // Handle voice audio from voice window for ElevenLabs STT
  ipcMain.on("voice-audio", async (event, data) => {
    try {
      const { buffer, mimeType } = data;
      const audioBuffer = Buffer.from(buffer);

      // ttsService is already required at the top as require("./services/elevenlabs-service.js")

      const transcribedText = await ttsService.transcribe(audioBuffer, {
        filename: 'audio.webm',
        contentType: mimeType || 'audio/webm'
      });

      console.log('[Main] STT result:', transcribedText);
      event.sender.send('stt-result', transcribedText);

    } catch (error) {
      console.error('[Main] Voice audio processing error:', error);
      event.sender.send('stt-result', '');
    }
  });



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
  globalShortcut.register("Ctrl+Shift+V", async () => {
    if (gemini.needsSetup()) return;
    await captureScreenForVoice();
    showVoiceWindow();
  });

  // Escape to close voice window
  globalShortcut.register("Escape", () => {
    hideVoiceWindow();
  });

  // === WAKE WORD DETECTION ===
  function createBackgroundAudioWindow() {
    if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) return;

    backgroundAudioWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, "background-audio-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    backgroundAudioWindow.loadFile("background-audio.html");

    backgroundAudioWindow.on("closed", () => {
      backgroundAudioWindow = null;
    });
  }

  function startBackgroundWakeWordDetection() {
    // Initialize wake word service first
    if (!wakeWordService.initialize()) {
      console.error('[Main] Wake word models not found, skipping wake word detection');
      return;
    }

    createBackgroundAudioWindow();

    // Handle model buffers request from renderer
    ipcMain.on("get-model-paths", async (event) => {
      try {
        const paths = wakeWordService.getModelPaths();
        const fsBody = require('fs');

        const [melspecBuffer, embeddingBuffer, wakewordBuffer] = await Promise.all([
          fsBody.promises.readFile(paths.melspectrogram),
          fsBody.promises.readFile(paths.embedding),
          fsBody.promises.readFile(paths.wakeword)
        ]);

        event.sender.send("model-buffers", {
          melspectrogram: Array.from(melspecBuffer),
          embedding: Array.from(embeddingBuffer),
          wakeword: Array.from(wakewordBuffer)
        });

        console.log('[Main] Sent model buffers to renderer');
      } catch (error) {
        console.error('[Main] Failed to load model files:', error);
      }
    });

    // Handle wake word detection from renderer (Web Worker)
    ipcMain.on("wake-word-detected", (event, data) => {
      const { wakeWord, score } = data;
      wakeWordService.handleDetection(wakeWord, score);
    });

    // Start the wake word service with callback
    wakeWordService.start((wakeWord) => {
      // Parallelize capture and mic switch
      console.log('[Main] Wake word triggered, preparing window...');

      captureScreenForVoice(); // Parallel

      // Wait for mic to be released then show
      ipcMain.once("mic-released", () => {
        showVoiceWindow();
      });

      if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
        backgroundAudioWindow.webContents.send("play-acknowledgment");
      }
    });

    // Handle background audio ready signal
    ipcMain.on("background-audio-ready", () => {
      console.log('[Main] Background audio window ready');
    });

    ipcMain.on("console-log", (event, msg) => {
      console.log(`[BackgroundAudio] ${msg}`);
    });

    ipcMain.on("console-error", (event, msg) => {
      console.error(`[BackgroundAudio] ${msg}`);
    });
  }

  // Capture screen helper
  async function captureScreenForVoice() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1280, height: 720 } // Slightly smaller for speed
      });

      if (sources.length > 0) {
        cachedScreenCapture = sources[0].thumbnail.toDataURL();
      }
    } catch (error) {
      cachedScreenCapture = null;
      console.error('[Main] Screen capture failed:', error);
    }
  }

  const handleCapture = async (event) => {
    try {
      // Ensure we have a capture
      if (!cachedScreenCapture) {
        await captureScreenForVoice();
      }

      // Use cached capture if available
      if (cachedScreenCapture) {
        // Check if sender still exists before sending
        if (!event.sender.isDestroyed()) {
          event.sender.send("screen-captured", cachedScreenCapture);
        }
      }
    } catch (error) {
      console.error("[Main] Handle capture error:", error);
    }
  };

  // Handle capture-screen from voice window
  ipcMain.on("capture-screen", handleCapture);

  // Global window reference for exported function
  module.exports = { startBackgroundWakeWordDetection: () => { } };
});
