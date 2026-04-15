// IPC Voice Handlers — handles voice-based queries from the renderer.
// Uses the shared query-pipeline for LLM → process → verbalize logic.
// Adds voice-specific: TTS, screen capture, search result selection, listen continuation.
const { ipcMain, shell, desktopCapturer } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const logger = require("../../lib/logger");
const llm = require("../../brain/llm");
const processor = require("../../brain/processor");
const orchestrator = require("../../brain/orchestrator");
const ttsService = require("../speech/tts");
const sttService = require("../speech/stt");
const uiPipeline = require("../ui-pipeline");
const connectivity = require("../../lib/connectivity");
const { executeQuery, dispatchResults } = require("./query-pipeline");

const OFFLINE_SUBTITLE = 'No internet connection. Please check your connection and try again.';

let cachedScreenCapture = null;

// Accumulates Venesa's questions across consecutive [action: listen] turns.
// Cleared as soon as Venesa responds normally (no listen action).
let listenContextStack = [];

function needsVisualContext(query) {
  if (!query) return false;
  const visualKeywords = [
    "show", "see", "look", "screen", "display", "what is", "what's",
    "read", "visible", "image", "picture", "window", "find on",
    "what do you see", "describe", "tell me about", "on my screen",
    "this", "that", "here", "there",
  ];
  const lowerQuery = query.toLowerCase().trim();
  return visualKeywords.some((keyword) => lowerQuery.includes(keyword));
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
    logger.error(`[voice] Screen capture failed: ${error.message}`);
  }
}

function sendStatus(event, stage) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("ai-status", stage);
  }
}

/**
 * Synthesize text to speech and send audio to the voice window.
 */
function speakResponse(event, text) {
  if (!ttsService.isAvailable() || !text || text.length === 0) return;
  ttsService
    .synthesizeToDataURL(text)
    .then((audioDataUrl) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-audio-ready", audioDataUrl);
      }
    })
    .catch((err) => {
      logger.error(`[voice] TTS synthesis failed: ${err.message}`);
    });
}

function register(getVoiceWindow, hideVoiceWindow) {
  ipcMain.on("voice-window-ready", () => { });

  ipcMain.on("close-voice-window", () => {
    hideVoiceWindow();
  });

  ipcMain.on("voice-query", async (event, payload) => {
    try {
      // Net guard — reject voice queries when offline
      if (!connectivity.isOnline()) {
        logger.warn('[voice] Blocked: offline');
        if (!event.sender.isDestroyed()) {
          event.sender.send('no-internet', { subtitle: OFFLINE_SUBTITLE });
        }
        return;
      }

      sendStatus(event, "thinking");

      // Determine if visual context is needed
      let imageToSend = null;
      if (needsVisualContext(payload.query)) {
        imageToSend = payload.image || cachedScreenCapture;
        if (imageToSend && !event.sender.isDestroyed()) {
          event.sender.send("screen-used");
        }
      }

      // Build query with listen context if present
      let finalQuery = payload.query;

      if (listenContextStack.length > 0) {
        const turns = listenContextStack
          .map((q, i) => `Q${i + 1}: "${q}"`)
          .join(" | ");
        finalQuery = `[CONVERSATION CONTEXT: You (Venesa) previously asked the user — ${turns}] User's latest response: "${payload.query}"`;
      }

      // Prepend search result context if user is selecting from results
      if (payload.previousResults && Array.isArray(payload.previousResults)) {
        const listStr = payload.previousResults
          .map((r) => `${r.index}. ${r.name} (${r.type})`)
          .join(", ");
        finalQuery = `[CONTEXT: User is viewing these search results: ${listStr}] User said: "${payload.query}"
        
        INSTRUCTION: 
        1. If user selects an item (by number like "one", "2", or name like "open <file name>", or position "the first one"), return [action: openFile, filePath: <path_from_list>] or [action: launchApplication, appName: <name_from_list>].
        2. If user says "cancel" or "close", return "No Problem!" and NO action.
        3. If user asks something new (e.g. "what is the weather"), ignore the list and answer the new question.
        
        Hidden paths data for your reference:
        ${JSON.stringify(payload.previousResults.map((r) => ({ index: r.index, path: r.path })))}`;
      }

      sendStatus(event, "working");

      // ── Use shared pipeline for LLM → process → verbalize ──
      const result = await executeQuery({
        query: finalQuery,
        imageData: imageToSend,
        mode: 'voice',
      });

      let finalResponse = result.text;
      let shouldListenAgain = result.shouldListen;

      // Dispatch UI blocks with halt-microphone
      if (result.uiBlocks && result.uiBlocks.length > 0 && !event.sender.isDestroyed()) {
        uiPipeline.dispatchUiBlocks(event.sender, result.uiBlocks);
        event.sender.send("halt-microphone");
      }

      // Dispatch structured UI from skill results
      if (result.results && result.results.length > 0 && !event.sender.isDestroyed()) {
        uiPipeline.dispatchFromResults(event.sender, result.results, result.uiDirective);
      }

      // Handle search results for voice selection UI
      if (result.searchData) {
        const searchResultData = result.searchData;
        const apps = searchResultData.apps || [];
        const files = searchResultData.files || [];
        const folders = searchResultData.folders || [];
        const totalCount = apps.length + files.length + folders.length;

        if (totalCount > 0) {
          const allResults = [];
          apps.forEach((app) =>
            allResults.push({ name: app.name, type: "app", data: app }),
          );
          folders.forEach((folder) =>
            allResults.push({
              name: typeof folder === "string" ? path.basename(folder) : folder.name,
              path: typeof folder === "string" ? folder : folder.path,
              type: "folder",
              data: typeof folder === "string" ? folder : folder.path,
            }),
          );
          files.forEach((file) =>
            allResults.push({
              name: typeof file === "string" ? path.basename(file) : file.name,
              path: typeof file === "string" ? file : file.path,
              type: "file",
              data: typeof file === "string" ? file : file.path,
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

          if (!finalResponse || finalResponse === 'Done.') {
            finalResponse = `I found ${totalCount} match${totalCount > 1 ? "es" : ""}. Which one would you like?`;
          }
        } else {
          if (!finalResponse || finalResponse === 'Done.') {
            finalResponse = "I couldn't find any matching files or apps.";
          }
        }
      }

      if (!finalResponse || finalResponse.trim() === "") {
        finalResponse = "Done.";
      }

      sendStatus(event, "speaking");

      // Send text response to voice window
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: finalResponse,
          audio: null,
        });
      }

      // Auto-close on cancel phrases
      const cancelRegex = /\b(cancelled|closing|cancel)\b|no problem!?/i;
      if (cancelRegex.test(finalResponse)) {
        shouldListenAgain = false;
        const voiceWindow = getVoiceWindow();
        setTimeout(() => {
          if (voiceWindow && !voiceWindow.isDestroyed()) {
            hideVoiceWindow();
          }
        }, 1500);
      }

      // Continue listening if [action: listen] was emitted
      if (shouldListenAgain && !event.sender.isDestroyed()) {
        const voiceWin = getVoiceWindow();
        if (voiceWin && !voiceWin.isDestroyed() && voiceWin.isVisible()) {
          if (finalResponse) listenContextStack.push(finalResponse);
          event.sender.send("continue-listening");
        }
      } else {
        listenContextStack = [];
      }

      // TTS synthesis
      speakResponse(event, finalResponse);

    } catch (error) {
      logger.error(`[voice] Voice query error: ${error.message}`, error);
      const errMsg = (error.message || '').toLowerCase();
      const isQuota =
        errMsg.includes('quota') ||
        errMsg.includes('429') ||
        errMsg.includes('rate') ||
        errMsg.includes('limit exceeded') ||
        errMsg.includes('exhausted') ||
        errMsg.includes('resource_exhausted');
      sendStatus(event, "idle");
      if (!event.sender.isDestroyed()) {
        event.sender.send("ai-error", { type: isQuota ? "quota" : "generic" });
      }
    }
  });

  ipcMain.on("audio-data", (event, audioBuffer) => {
    if (sttService && sttService.isListening) {
      sttService.feedAudio(Buffer.from(audioBuffer));
    }
  });

  ipcMain.on("restart-stt", () => {
    const voiceWindow = getVoiceWindow();

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
      } catch (err) {
        logger.error(
          `[voice] safeSend failed for channel ${channel}: ${err.message}`,
        );
      }
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
        if (!event.sender.isDestroyed()) {
          event.sender.send("voice-response", {
            text: "Error: Invalid selection data",
            audio: null,
          });
        }
        return;
      }

      sendStatus(event, "working");

      const { originalQuery, selectedItem } = payload;

      const contextQuery = `The user said "${originalQuery}" and selected a ${selectedItem.type} named "${selectedItem.name}". The full path is "${selectedItem.path}". Based on the original request, what action should I take? If the user was searching for something to open/launch, open it. If they wanted to find/locate it, show it in the folder. Respond with the action to take.`;

      const rawResponse = await llm.sendQuery(contextQuery, null, "voice");
      const { cleanResponse, results } = await processor.processResponse(
        rawResponse,
        "voice",
      );

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
              const launchResult = await orchestrator.executeAction('launchApplication', { appName: selectedItem.name });
              if (!launchResult.success) {
                openError = launchResult.error || 'Failed to launch application';
              }
            } catch (err) {
              openError = err.message || "Failed to launch application";
            }
          }
        }

        if (
          selectedItem.type !== "app" ||
          (selectedItem.type === "app" && openError)
        ) {
          if (selectedItem.path) {
            const rawPath = selectedItem.path;
            let itemPath = path.isAbsolute(rawPath)
              ? rawPath
              : path.join(os.homedir(), rawPath);
            const fold = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
            try {
              const realItemPath = fs.realpathSync(itemPath);
              const realHome = fs.realpathSync(os.homedir());
              const normalizedItem = fold(path.normalize(realItemPath));
              const homeNorm = fold(path.normalize(realHome));
              const homePrefix = fold(path.normalize(realHome + path.sep));
              if (
                normalizedItem !== homeNorm &&
                !normalizedItem.startsWith(homePrefix)
              ) {
                openError = "Access denied: path escapes home directory";
              } else {
                itemPath = realItemPath;
              }
            } catch (e) {
              openError = `Path resolution failed: ${e.message}`;
            }
            if (!openError) {
              openError = await shell.openPath(itemPath);
            }
          }
        }

        if (!openError) {
          finalResponse = `Opening ${selectedItem.name}.`;
        } else {
          logger.error(`[voice] Failed to open path: ${openError}`);
          finalResponse = `I couldn't open that item.`;
        }
      }

      sendStatus(event, "speaking");

      if (!event.sender.isDestroyed()) {
        event.sender.send("action-complete");
        event.sender.send("voice-response", {
          text: finalResponse,
          audio: null,
        });
      }

      speakResponse(event, finalResponse);
    } catch (error) {
      logger.error(`[voice] voice-file-action error: ${error.message}`);
      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: `Something went wrong.`,
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

      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send("stt-result", transcribedText);
      }
    } catch (error) {
      logger.error(`[voice] Voice audio processing error: ${error.message}`);
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send("stt-result", "");
      }
    }
  });

  ipcMain.on("capture-screen-fullres", async (event) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      if (sources.length > 0) {
        const imageData = sources[0].thumbnail.toDataURL();
        if (!event.sender.isDestroyed()) {
          event.sender.send("screen-captured", imageData);
        }
      }
    } catch (error) {
      logger.error(`[voice] Region capture failed: ${error.message}`);
    }
  });

  ipcMain.on("capture-screen", async (event) => {
    try {
      if (!cachedScreenCapture) {
        await captureScreenForVoice();
      }
      if (cachedScreenCapture && !event.sender.isDestroyed()) {
        event.sender.send("screen-captured", cachedScreenCapture);
      }
    } catch (error) {
      logger.error(`[voice] Handle capture error: ${error.message}`);
    }
  });
}

module.exports = { register, captureScreenForVoice };
