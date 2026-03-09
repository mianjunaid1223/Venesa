const { ipcMain, shell, desktopCapturer, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const logger = require("../../lib/logger");
const llm = require("../../brain/llm");
const processor = require("../../brain/processor");
const orchestrator = require("../../brain/orchestrator");
const memory = require("../../brain/memory");
const ttsService = require("../speech/tts");
const sttService = require("../speech/stt");
const uiPipeline = require("../ui-pipeline");
const connectivity = require("../../lib/connectivity");

const OFFLINE_SUBTITLE = 'No internet connection. Please check your connection and try again.';

const RESULT_MAX_CHARS = 1500;

/**
 * Returns a compact string representation of a tool result, truncated to
 * RESULT_MAX_CHARS if necessary so LLM prompts stay within safe size limits.
 * @param {*} result  Raw tool result (any type).
 * @param {number} [maxChars]  Override the default character limit.
 * @returns {string}
 */
function summarizeOrTruncateResult(result, maxChars = RESULT_MAX_CHARS) {
  const util = require('util');
  function safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch {
      try { return util.inspect(value, { depth: null }); } catch { return '[Unserializable object]'; }
    }
  }

  let str;
  if (typeof result === 'string') {
    str = result;
  } else if (Array.isArray(result)) {
    // Summarise arrays: include item count and first few entries
    const preview = safeStringify(result.slice(0, 10));
    str = result.length > 10
      ? `(${result.length} items) ${preview} … [TRUNCATED]`
      : safeStringify(result);
  } else if (result && typeof result === 'object') {
    str = safeStringify(result);
  } else {
    str = String(result);
  }
  if (str.length > maxChars) {
    return str.slice(0, maxChars) + ' … [TRUNCATED]';
  }
  return str;
}

let cachedScreenCapture = null;

// Accumulates Venesa's questions across consecutive [action: listen] turns.
// Cleared as soon as Venesa responds normally (no listen action).
let listenContextStack = [];

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

      let imageToSend = null;
      if (needsVisualContext(payload.query)) {
        imageToSend = payload.image || cachedScreenCapture;
        if (imageToSend && !event.sender.isDestroyed()) {
          event.sender.send("screen-used");
        }
      }

      let finalQuery = payload.query;

      if (listenContextStack.length > 0) {
        const turns = listenContextStack
          .map((q, i) => `Q${i + 1}: "${q}"`)
          .join(" | ");
        finalQuery = `[CONVERSATION CONTEXT: You (Venesa) previously asked the user — ${turns}] User's latest response: "${payload.query}"`;
      }

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

      const rawResponse = await llm.sendQuery(finalQuery, imageToSend, "voice");

      sendStatus(event, "working");

      const { cleanResponse, results, uiDirective, uiBlocks } =
        await processor.processResponse(rawResponse, "voice");

      let finalResponse = (cleanResponse || "")
        .replace(/\[NEED_SCREEN\]/g, "")
        .trim();
      let hasSearchResults = false;
      let searchResultData = null;
      let shouldListenAgain = false;

      if (results && results.length > 0) {
        for (const res of results) {
          if (res.actionName === "listen") {
            shouldListenAgain = true;
            continue;
          }
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
            } catch (e) {
              logger.error(`[voice] Search parse error: ${e.message}`);
            }
            continue;
          }
        }

        // For data-returning skills, do a second LLM pass to verbalize the result naturally.
        // The first pass only emits the action — the result isn't known until after execution.
        // Suppress the initial [speak] text — only speak after data is received and verbalized.
        const dataResults = results.filter(
          (r) => (
            r.returnType === "data" ||
            (r.returnType === "memory" && r.actionName === "getMemory")
          ) && (r.result !== undefined || r.error),
        );
        if (dataResults.length > 0) {
          // Clear anticipatory speak text — we only want the verbalized data response
          finalResponse = "";
          try {
            const resultContext = dataResults
              .map((r) => {
                if (r.error) {
                  return `[FAILED ${r.actionName}: ${r.error}]`;
                }
                // surface success:false from the handler's own return value
                const raw = r.result;
                if (raw && typeof raw === 'object' && raw.success === false) {
                  return `[FAILED ${r.actionName}: ${raw.error || 'Unknown error'}]`;
                }
                return `[RESULT for ${r.actionName}: ${summarizeOrTruncateResult(r.result)}]`;
              })
              .join("\n");
            const verbalizeQuery = `${resultContext}
The user asked (via voice): "${payload.query}"

Present this data naturally. Rules:
- Speak conversationally in 1-2 sentences maximum.
- If some results FAILED and others SUCCEEDED, speak the successful ones and note which ones could not be retrieved — do this naturally, not as an error message.
- If ALL results failed, say so naturally in one sentence without technical detail.
- If the data is clearer as a table or visual (e.g. comparisons, rankings, multi-column data), place the formatted data inside a [ui] block inside [silent] and keep spoken text brief (e.g. "Here's the comparison.").
- Use [speak]...[/speak] for the spoken part and [silent][ui]...[/ui][/silent] for any visual block.
- Do NOT emit new [action:] tags.`;
            const verbalRaw = await llm.sendQuery(verbalizeQuery, null, "voice");
            // Only extract speak/ui blocks — never execute actions from verbalization response
            const speakMatch = verbalRaw.match(/\[speak\]([\s\S]*?)\[\/speak\]/i);
            const spokenResult = speakMatch ? speakMatch[1].trim() : verbalRaw
              .replace(/\[action:[^\]]*\]/gi, '')
              .replace(/\[plan\][\s\S]*?\[\/plan\]/gi, '')
              .replace(/\[step:[^\]]*\]/gi, '')
              .replace(/\[silent\][\s\S]*?\[\/silent\]/gi, '')
              .replace(/\[ui\][\s\S]*?\[\/ui\]/gi, '')
              .trim();
            const verbalUiBlockMatches = [...verbalRaw.matchAll(/\[ui\]([\s\S]*?)\[\/ui\]/gi)];
            const verbalUiBlocks = verbalUiBlockMatches.map(m => m[1].trim()).filter(Boolean);
            if (spokenResult && spokenResult.trim()) {
              finalResponse = spokenResult.trim();
            }
            // Dispatch any [ui] blocks produced by the verbalization pass
            if (verbalUiBlocks && verbalUiBlocks.length > 0 && !event.sender.isDestroyed()) {
              uiPipeline.dispatchUiBlocks(event.sender, verbalUiBlocks);
              event.sender.send("halt-microphone");
            }
          } catch (verbalErr) {
            logger.warn(`[voice] Verbalization pass failed: ${verbalErr.message}`);
            // Fallback — don't leak the anticipatory text
            finalResponse = "I couldn't retrieve that information right now.";
          }
        }
      }

      if (uiBlocks && uiBlocks.length > 0) {
        uiPipeline.dispatchUiBlocks(event.sender, uiBlocks);

        if (!event.sender.isDestroyed()) {
          event.sender.send("halt-microphone");
        }
      }

      if (results && results.length > 0) {
        if (event.sender && !event.sender.isDestroyed()) {
          uiPipeline.dispatchFromResults(event.sender, results, uiDirective);
        }
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

        if (totalCount > 0) {
          if (!finalResponse) {
            finalResponse = `I found ${totalCount} match${totalCount > 1 ? "es" : ""}. Which one would you like?`;
          }
        } else {
          if (!finalResponse)
            finalResponse = "I couldn't find any matching files or apps.";
        }
      }

      if (!finalResponse || finalResponse.trim() === "") {
        finalResponse = "Done.";
      }

      sendStatus(event, "speaking");

      if (!event.sender.isDestroyed()) {
        event.sender.send("voice-response", {
          text: finalResponse,
          audio: null,
        });
      }

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

      if (shouldListenAgain && !event.sender.isDestroyed()) {
        const voiceWin = getVoiceWindow();
        if (voiceWin && !voiceWin.isDestroyed() && voiceWin.isVisible()) {
          if (finalResponse) listenContextStack.push(finalResponse);
          event.sender.send("continue-listening");
        }
      } else {
        listenContextStack = [];
      }

      if (ttsService.isAvailable() && finalResponse.length > 0) {
        ttsService
          .synthesizeToDataURL(finalResponse)
          .then((audioDataUrl) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("voice-audio-ready", audioDataUrl);
            }
          })
          .catch((err) => {
            logger.error(`[voice] TTS synthesis failed: ${err.message}`);
          });
      }

      try {
        memory.addInteraction(payload.query, finalResponse, rawResponse);
      } catch (memErr) {
        logger.warn(`[voice] History write failed: ${memErr.message}`);
      }
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

      if (ttsService.isAvailable() && finalResponse.length > 0) {
        ttsService
          .synthesizeToDataURL(finalResponse)
          .then((audioDataUrl) => {
            if (!event.sender.isDestroyed()) {
              event.sender.send("voice-audio-ready", audioDataUrl);
            }
          })
          .catch((err) => {
            logger.error(`[voice] TTS synthesis failed: ${err.message}`);
          });
      }
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
