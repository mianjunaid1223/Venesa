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
const fs = require("fs");
const gemini = require("../core/llm-service.js");
const taskExecutor = require("../core/task-service.js");
const sttService = require("../core/stt-service.js");
const ttsService = require("../core/elevenlabs-service.js");
const wakeWordService = require("../core/wake-word-service.js");

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
  // Only enable auto-start if user preference allows
  // Check for settings file or environment variable
  const settingsPath = path.join(os.homedir(), '.venesa-settings.json');
  let autoStartEnabled = false;
  try {
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      autoStartEnabled = settings.openAtLogin !== false; // Default true if not specified
    }
  } catch (e) {
    // Default to true on error
    autoStartEnabled = true;
  }

  if (autoStartEnabled) {
    app.setLoginItemSettings({
      openAtLogin: true,
      path: app.getPath("exe"),
      args: ["--hidden"],
    });
  }

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

  // Auto-grant permissions (microphone only from trusted origins)
  const { session } = require('electron');
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    // Only auto-approve microphone access (required for voice features)
    if (permission === 'media') {
      return callback(true);
    }
    // Deny other permissions - user must explicitly approve
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
      // Check if sender is valid before proceeding
      if (!event.sender || event.sender.isDestroyed()) {
        console.warn('[Main] send-to-gemini: Sender destroyed before processing');
        return;
      }

      const rawResponse = await gemini.sendQuery(query);

      // Check sender again after async operation
      if (!event.sender || event.sender.isDestroyed()) {
        console.warn('[Main] send-to-gemini: Sender destroyed after query');
        return;
      }

      // Process response centrally (executes actions)
      const { cleanResponse, results } = await taskExecutor.processResponse(rawResponse);

      // Send the clean text response to renderer
      if (!event.sender.isDestroyed()) {
        event.sender.send("gemini-response", cleanResponse);
      }

      // Send execution results back to renderer
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
        // Validate appId to prevent command injection
        // AppUserModelId should only contain safe characters: letters, numbers, dots, underscores
        const safeAppIdPattern = /^[a-zA-Z0-9._!\-]+$/;
        if (!safeAppIdPattern.test(appInfo.appId)) {
          console.error("Invalid appId format:", appInfo.appId);
          return;
        }
        const { execFile } = require("child_process");
        // Use execFile with args array to prevent shell injection
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
    // Prevent concurrent animations
    if (animationInProgress) {
      return;
    }

    if (animationTimeout) {
      clearTimeout(animationTimeout);
      animationTimeout = null;
    }

    // Guard: ensure mainWindow exists and is not destroyed
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const bounds = mainWindow.getBounds();
    const heightDiff = toHeight - fromHeight;
    const stepDuration = ANIMATION_DURATION / ANIMATION_STEPS;
    let currentStep = 0;

    const animate = () => {
      // Check if window still exists
      if (!mainWindow || mainWindow.isDestroyed()) {
        if (animationTimeout) clearTimeout(animationTimeout);
        animationInProgress = false;
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

      if (currentStep < ANIMATION_STEPS && mainWindow && !mainWindow.isDestroyed()) {
        animationTimeout = setTimeout(animate, stepDuration);
      } else {
        animationInProgress = false;
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
        preload: path.join(__dirname, "preload/voice.preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    voiceWindow.loadFile(path.join(__dirname, "../renderer/voice.window.html"));

    // Handle renderer crashes
    voiceWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('[VoiceWindow] Renderer crashed:', details.reason);
      // Recreate the window on crash
      voiceWindow = null;
    });

    voiceWindow.webContents.on('crashed', (event, killed) => {
      console.error('[VoiceWindow] WebContents crashed, killed:', killed);
      voiceWindow = null;
    });

    // Clicking outside (blur) or Esc hides the window
    voiceWindow.on("blur", () => {
      // Small delay to prevent accidental closure on activation
      setTimeout(() => {
        // Double check window still exists and is valid
        if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
          console.log('[Main] hideVoiceWindow triggered by: blur event');
          hideVoiceWindow();
        }
      }, 500);
    });

    voiceWindow.on("closed", () => {
      voiceWindow = null;
    });
  }

  function showVoiceWindow() {
    // If window doesn't exist or was destroyed, recreate it
    if (!voiceWindow || voiceWindow.isDestroyed()) {
      createVoiceWindow();
    }

    closeAllFeatureWindows();

    // Guard to ensure start-listening is only sent once
    let startListeningSent = false;

    // Helper to safely send IPC only when webContents is ready
    const safeSend = (channel, data) => {
      try {
        if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.webContents && !voiceWindow.webContents.isDestroyed()) {
          voiceWindow.webContents.send(channel, data);
        }
      } catch (err) {
        // Silently ignore - "Render frame was disposed" errors are expected during window transitions
      }
    };

    // Start STT service - only handle text and partial results here
    // start-listening is handled separately with proper window ready check
    sttService.start((type, text) => {
      if (type === 'text') {
        safeSend('stt-result', text);
      } else if (type === 'partial') {
        safeSend('stt-partial-result', text);
      }
      // 'ready' type is intentionally not handled here to avoid double-send
    });

    // Wait for window to be ready before sending IPC
    const sendStartListening = () => {
      if (!startListeningSent) {
        startListeningSent = true;
        safeSend('start-listening');
      }
    };

    // Check if webContents is already loaded
    if (voiceWindow.webContents.isLoading()) {
      voiceWindow.webContents.once('did-finish-load', sendStartListening);
    } else {
      // Small delay to ensure renderer IPC handlers are registered
      setTimeout(sendStartListening, 50);
    }

    voiceWindow.show();
    voiceWindow.focus();
  }

  function hideVoiceWindow() {
    // Helper to safely send IPC without crashing
    const safeSendToVoice = (channel, data) => {
      try {
        if (voiceWindow && !voiceWindow.isDestroyed() &&
          voiceWindow.webContents && !voiceWindow.webContents.isDestroyed()) {
          voiceWindow.webContents.send(channel, data);
        }
      } catch (e) {
        // Silently ignore - "Render frame was disposed" errors are expected during window close
      }
    };

    if (voiceWindow && !voiceWindow.isDestroyed()) {
      voiceWindow.hide();
      sttService.stop();

      // Send stop-listening to voice window to ensure mic is released
      safeSendToVoice('stop-listening');

      // Resume wake word detection with a small delay to ensure voice window mic is released
      setTimeout(() => {
        wakeWordService.resume();
        // Resume background audio mic
        if (backgroundAudioWindow && !backgroundAudioWindow.isDestroyed()) {
          try {
            if (backgroundAudioWindow.webContents && !backgroundAudioWindow.webContents.isDestroyed()) {
              backgroundAudioWindow.webContents.send("resume-detection");
            }
          } catch (e) { /* ignore */ }
        }
      }, 100);
    }
  }

  // IPC Handlers
  ipcMain.on("close-voice-window", () => {
    console.log('[Main] hideVoiceWindow triggered by: close-voice-window IPC');
    hideVoiceWindow();
  });
  ipcMain.on("auto-close-voice", () => {
    console.log('[Main] hideVoiceWindow triggered by: auto-close-voice IPC');
    hideVoiceWindow();
  });

  // Duplicate handlers for launch-app, open-folder, open-file removed
  // Original handlers with full validation exist at lines 296-343

  ipcMain.on("open-voice-window", () => { showVoiceWindow(); });

  // Warm up the window at startup
  createVoiceWindow();

  // Cache for screen capture
  let cachedScreenCapture = null;

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
      let imageToSend = null;

      if (needsVisualContext(payload.query)) {
        imageToSend = payload.image || cachedScreenCapture;
      }

      // Single Gemini request - AI decides intent and announces actions naturally
      const rawResponse = await gemini.sendQuery(payload.query, imageToSend, 'voice');

      // Process response centrally (executes actions)
      const { cleanResponse, results } = await taskExecutor.processResponse(rawResponse);

      // Clean up any [NEED_SCREEN] tags from cleanResponse
      let finalResponse = cleanResponse.replace(/\[NEED_SCREEN\]/g, '').trim();

      // Track state for search results and listen action
      let hasSearchResults = false;
      let searchResultData = null;
      let shouldListenAgain = false;

      // Process results and aggregate feedback
      let feedback = [];
      if (results && results.length > 0) {
        for (const res of results) {
          if (res.actionName === 'searchFiles' && res.result) {
            try {
              searchResultData = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
              const hasItems = (searchResultData.apps?.length || 0) + (searchResultData.files?.length || 0) + (searchResultData.folders?.length || 0) > 0;
              if (hasItems) hasSearchResults = true;
              else feedback.push("I couldn't find any matching files or apps.");
            } catch (e) {
              console.error('[Main] Search parse error:', e);
            }
          } else if (res.actionName === 'getSystemInfo' && res.result) {
            try {
              const info = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
              if (info && !info.error) {
                feedback.push(`CPU is at ${info.cpuUsage}, RAM is ${info.ramUsed} of ${info.ramTotal}GB, battery is at ${info.battery}, and uptime is ${info.uptime}.`);
              }
            } catch (e) { }
          } else if (res.actionName === 'systemControl' && res.result) {
            if (res.result.toLowerCase().includes('error')) feedback.push(`System control failed: ${res.result}`);
          } else if (res.actionName === 'listen') {
            shouldListenAgain = true;
          }
        }
      }

      // Append all feedback to the natural language response
      if (feedback.length > 0) {
        finalResponse = (finalResponse + " " + feedback.join(" ")).trim();
      }

      // Handle search results with smart responses
      if (hasSearchResults && searchResultData) {
        const apps = searchResultData.apps || [];
        const files = searchResultData.files || [];
        const folders = searchResultData.folders || [];
        const totalCount = apps.length + files.length + folders.length;

        if (totalCount === 1) {
          // Single result - auto-open with confirmation
          let itemName = '';
          let itemType = '';

          if (apps.length === 1) {
            const app = apps[0];
            itemName = app.name;
            itemType = 'app';
            if (app.path) {
              shell.openPath(app.path);
            }
          } else if (folders.length === 1) {
            const folderPath = path.isAbsolute(folders[0]) ? folders[0] : path.join(os.homedir(), folders[0]);
            itemName = path.basename(folders[0]);
            itemType = 'folder';
            shell.openPath(folderPath);
          } else if (files.length === 1) {
            const filePath = path.isAbsolute(files[0]) ? files[0] : path.join(os.homedir(), files[0]);
            itemName = path.basename(files[0]);
            itemType = 'file';
            shell.openPath(filePath);
          }

          finalResponse = `Opening ${itemName}.`;

        } else if (totalCount > 1) {
          // Multiple results - list them and ask user to choose
          const allResults = [];

          apps.forEach(app => allResults.push({ name: app.name, type: 'app', data: app }));
          folders.forEach(folder => allResults.push({ name: path.basename(folder), type: 'folder', data: folder }));
          files.forEach(file => allResults.push({ name: path.basename(file), type: 'file', data: file }));

          // Limit to first 5 for voice selection
          const displayResults = allResults.slice(0, 5);

          // Build spoken list
          let listText = `I found ${totalCount} result${totalCount > 1 ? 's' : ''}. `;
          displayResults.forEach((item, i) => {
            listText += `${i + 1}, ${item.name}. `;
          });
          listText += "Which one do you want?";

          finalResponse = listText;
          shouldListenAgain = true;

          // Store results for selection (attach to voice window)
          if (!event.sender.isDestroyed()) {
            event.sender.send("voice-search-results", {
              results: displayResults,
              totalCount,
              waitingForSelection: true
            });
          }
        }
      }

      // Ensure we have some response
      if (!finalResponse || finalResponse.trim() === '') {
        finalResponse = 'Done.';
      }

      // Send text response IMMEDIATELY
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: finalResponse,
          audio: null // Will be sent separately
        });
      }

      // Handle listen action - signal voice window to continue listening
      if (shouldListenAgain && !event.sender.isDestroyed()) {
        event.sender.send("continue-listening");
      }

      // Synthesize TTS in parallel - send when ready
      if (ttsService.isAvailable() && finalResponse.length > 0) {
        ttsService.synthesizeToDataURL(finalResponse)
          .then(audioDataUrl => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("voice-audio-ready", audioDataUrl);
            }
          })
          .catch(ttsError => { });
      }
    } catch (error) {
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", { text: `Error: ${error}`, audio: null });
      }
    }
  });

  // Handle audio data from renderer (Web Audio API)
  ipcMain.on("audio-data", (event, audioBuffer) => {
    if (sttService && sttService.isListening) {
      sttService.feedAudio(Buffer.from(audioBuffer));
    }
  });

  // Handle voice audio from voice window for ElevenLabs STT
  ipcMain.on("voice-audio", async (event, data) => {
    try {
      const { buffer, mimeType } = data;
      const audioBuffer = Buffer.from(buffer);

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

  // Escape to close voice window - only when voice window is visible
  globalShortcut.register("Escape", () => {
    // Only act on Escape when voice window is visible
    if (voiceWindow && !voiceWindow.isDestroyed() && voiceWindow.isVisible()) {
      console.log('[Main] hideVoiceWindow triggered by: Escape key');
      hideVoiceWindow();
    }
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
        preload: path.join(__dirname, "preload/background.preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    backgroundAudioWindow.loadFile(path.join(__dirname, "../renderer/background.window.html"));

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
    // Remove any existing listener to prevent duplicates if function called multiple times
    ipcMain.removeAllListeners("get-model-paths");
    ipcMain.on("get-model-paths", async (event) => {
      try {
        const paths = wakeWordService.getModelPaths();

        const [melspecBuffer, embeddingBuffer, wakewordBuffer] = await Promise.all([
          fs.promises.readFile(paths.melspectrogram),
          fs.promises.readFile(paths.embedding),
          fs.promises.readFile(paths.wakeword)
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
      console.log('[Main] Wake word triggered, preparing window...');

      captureScreenForVoice(); // Parallel

      // Wait for mic to be released with timeout fallback
      const MIC_RELEASE_TIMEOUT = 3000; // 3 seconds max wait
      let micReleaseHandler = null;
      let timeoutId = null;

      const showWindowAndCleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (micReleaseHandler) {
          ipcMain.removeListener("mic-released", micReleaseHandler);
        }
        showVoiceWindow();
      };

      micReleaseHandler = () => {
        showWindowAndCleanup();
      };

      ipcMain.once("mic-released", micReleaseHandler);

      // Timeout fallback in case mic-released never fires
      timeoutId = setTimeout(() => {
        console.log('[Main] mic-released timeout, showing voice window anyway');
        ipcMain.removeListener("mic-released", micReleaseHandler);
        showVoiceWindow();
      }, MIC_RELEASE_TIMEOUT);

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

    ipcMain.on("resume-failed", () => {
      console.error('[Main] Wake word detection failed to resume - mic may be in use');
      // Optionally could show a notification to user or attempt recovery
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
});

// Export the wake word function at module level
// Note: The actual function is defined inside app.whenReady() but we export a reference
let _startBackgroundWakeWordDetection = null;

module.exports = {
  startBackgroundWakeWordDetection: () => {
    if (_startBackgroundWakeWordDetection) {
      _startBackgroundWakeWordDetection();
    }
  }
};
