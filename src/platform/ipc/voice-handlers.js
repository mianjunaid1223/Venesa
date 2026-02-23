/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: IPC Voice Handlers
 *  Handles voice-mode interactions, TTS/STT dispatch, screen capture.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/llm, brain/processor, platform/speech/tts,
 *              platform/speech/stt, platform/formatters
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const { ipcMain, shell, desktopCapturer, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const logger = require('../../lib/logger');
const llm = require('../../brain/llm');
const processor = require('../../brain/processor');
const ttsService = require('../speech/tts');
const sttService = require('../speech/stt');
const { formatForVoice, DISPLAY_ONLY_ACTIONS } = require('../formatters');
const uiPipeline = require('../ui-pipeline');

let cachedScreenCapture = null;

function needsVisualContext(query) {
    if (!query) return false;
    const visualKeywords = [
        'show', 'see', 'look', 'screen', 'display',
        'what is', "what's", 'read', 'visible', 'image',
        'picture', 'window', 'find on', 'what do you see',
        'describe', 'tell me about', 'on my screen',
        'this', 'that', 'here', 'there',
    ];
    const lowerQuery = query.toLowerCase().trim();
    return visualKeywords.some((keyword) => lowerQuery.includes(keyword));
}

async function captureScreenForVoice() {
    try {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
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

function sendToMainWindow(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    const mainWin = windows.find(w => !w.isDestroyed() && w.getTitle() !== 'Voice');
    if (mainWin && !mainWin.isDestroyed()) {
        if (!mainWin.isVisible()) {
            mainWin.show();
        }
        if (mainWin.isMinimized()) {
            mainWin.restore();
        }
        mainWin.webContents.send(channel, data);
    }
}

function register(getVoiceWindow, hideVoiceWindow) {
    ipcMain.on('voice-window-ready', () => { });

    ipcMain.on('close-voice-window', () => {
        hideVoiceWindow();
    });

    ipcMain.on('voice-query', async (event, payload) => {
        try {
            let imageToSend = null;
            if (needsVisualContext(payload.query)) {
                imageToSend = payload.image || cachedScreenCapture;
            }

            let finalQuery = payload.query;

            if (payload.previousResults && Array.isArray(payload.previousResults)) {
                const listStr = payload.previousResults
                    .map((r) => `${r.index}. ${r.name} (${r.type})`)
                    .join(', ');
                finalQuery = `[CONTEXT: User is viewing these search results: ${listStr}] User said: "${payload.query}"
        
        INSTRUCTION: 
        1. If user selects an item (by number like "one", "2", or name like "open resume", or position "the first one"), return [action: openFile, filePath: <path_from_list>] or [action: launchApplication, appName: <name_from_list>].
        2. If user says "cancel" or "close", return "No Problem!" and NO action.
        3. If user asks something new (e.g. "what is the weather"), ignore the list and answer the new question.
        
        Hidden paths data for your reference:
        ${JSON.stringify(payload.previousResults.map((r) => ({ index: r.index, path: r.path })))}`;
            }

            const rawResponse = await llm.sendQuery(finalQuery, imageToSend, 'voice');
            const { cleanResponse, results, uiDirective } = await processor.processResponse(rawResponse);

            let finalResponse = cleanResponse.replace(/\[NEED_SCREEN\]/g, '').trim();
            let hasSearchResults = false;
            let searchResultData = null;
            let shouldListenAgain = false;

            let feedback = [];

            // Actions that display info — they should NEVER trigger listen-again
            const INFO_ONLY_ACTIONS = new Set([
                'getSystemInfo', 'getDiskInfo', 'getNetworkInfo', 'listProcesses',
                'getTime', 'getClipboard', 'calculate', 'setMemory', 'getMemory',
                'setReminder', 'launchApplication', 'closeApp', 'closeAllApps',
                'openFile', 'openUrl', 'googleSearch', 'youtubeSearch', 'getWeather',
                'systemControl', 'takeScreenshot', 'runPowerShell', 'listRunningApps',
                'getInstalledApps', 'listCommands', 'saveCommand', 'removeCommand',
                'setClipboard',
            ]);

            if (results && results.length > 0) {
                for (const res of results) {
                    if (res.actionName === 'listen') {
                        shouldListenAgain = true;
                        continue;
                    }
                    if (uiDirective && DISPLAY_ONLY_ACTIONS.has(res.actionName)) continue;
                    if (res.marker === 'silently' && !res.error) {
                        const fb = formatForVoice(res);
                        if (fb) feedback.push(fb);
                        continue;
                    }
                    if (res.skipped) continue;

                    if (res.actionName === 'searchFiles' && res.result) {
                        try {
                            searchResultData = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
                            const hasItems =
                                (searchResultData.apps?.length || 0) +
                                (searchResultData.files?.length || 0) +
                                (searchResultData.folders?.length || 0) > 0;
                            if (hasItems) hasSearchResults = true;
                            else feedback.push("I couldn't find any matching files or apps.");
                        } catch (e) {
                            logger.error(`[Main] Search parse error: ${e.message}`);
                        }
                        continue;
                    }

                    const fb = formatForVoice(res);
                    if (fb) feedback.push(fb);
                }

                // If ALL non-listen results are info-only display actions, don't listen.
                // The AI sometimes incorrectly adds [action: listen] after showing stats.
                const nonListenActions = results.filter(r => r.actionName !== 'listen');
                if (nonListenActions.length > 0 && nonListenActions.every(r => INFO_ONLY_ACTIONS.has(r.actionName))) {
                    shouldListenAgain = false;
                }
            }

            if (feedback.length > 0) {
                finalResponse = (finalResponse + ' ' + feedback.join(' ')).trim();
            }

            if (results && results.length > 0) {
                const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.getTitle() !== 'Voice');
                uiPipeline.dispatchFromResults(mainWin, results, uiDirective);
                const senderWin = BrowserWindow.fromWebContents(event.sender);
                uiPipeline.dispatchFromResults(senderWin, results, uiDirective);

                // If there's dynamic UI to show, bring the main window to front
                // so the user can see the visual data (tables, key-value, card lists)
                if (uiDirective && mainWin && !mainWin.isDestroyed()) {
                    const mainWinModule = require('../windows/main-window');
                    mainWinModule.showWindow();
                }
            }

            if (hasSearchResults && searchResultData) {
                const apps = searchResultData.apps || [];
                const files = searchResultData.files || [];
                const folders = searchResultData.folders || [];
                const totalCount = apps.length + files.length + folders.length;

                const allResults = [];
                apps.forEach((app) => allResults.push({ name: app.name, type: 'app', data: app }));
                folders.forEach((folder) => allResults.push({ name: path.basename(folder), type: 'folder', data: folder }));
                files.forEach((file) => allResults.push({ name: path.basename(file), type: 'file', data: file }));
                const displayResults = allResults.slice(0, 5);

                if (!event.sender.isDestroyed()) {
                    event.sender.send('voice-search-results', {
                        results: displayResults,
                        totalCount,
                        waitingForSelection: true,
                    });
                }

                if (totalCount > 0) {
                    finalResponse = `I found ${totalCount} match${totalCount > 1 ? 'es' : ''}. Which one would you like?`;
                    shouldListenAgain = true;
                } else {
                    finalResponse = "I couldn't find any matching files or apps.";
                }
            }

            if (!finalResponse || finalResponse.trim() === '') {
                finalResponse = 'Done.';
            }

            if (!event.sender.isDestroyed()) {
                event.sender.send('voice-response', { text: finalResponse, audio: null });
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
                event.sender.send('continue-listening');
            }

            if (ttsService.isAvailable() && finalResponse.length > 0) {
                ttsService
                    .synthesizeToDataURL(finalResponse)
                    .then((audioDataUrl) => {
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('voice-audio-ready', audioDataUrl);
                        }
                    })
                    .catch((err) => { console.error('[Main] TTS synthesis failed:', err.message); });
            }
        } catch (error) {
            if (!event.sender.isDestroyed()) {
                event.sender.send('voice-response', { text: `Error: ${error.message || String(error)}`, audio: null });
            }
        }
    });

    ipcMain.on('audio-data', (event, audioBuffer) => {
        if (sttService && sttService.isListening) {
            sttService.feedAudio(Buffer.from(audioBuffer));
        }
    });

    ipcMain.on('restart-stt', () => {
        const voiceWindow = getVoiceWindow();

        const safeSend = (channel, data) => {
            try {
                if (voiceWindow && !voiceWindow.isDestroyed() &&
                    voiceWindow.webContents && !voiceWindow.webContents.isDestroyed()) {
                    voiceWindow.webContents.send(channel, data);
                }
            } catch (err) {
                console.error(`[Main] safeSend failed for channel ${channel}:`, err);
            }
        };

        sttService.start((type, text) => {
            if (type === 'text') {
                safeSend('stt-result', text);
            } else if (type === 'partial') {
                safeSend('stt-partial-result', text);
            }
        });
    });

    ipcMain.on('voice-file-action', async (event, payload) => {
        try {
            if (!payload || !payload.selectedItem || typeof payload.selectedItem !== 'object') {
                if (!event.sender.isDestroyed()) {
                    event.sender.send('voice-response', { text: 'Error: Invalid selection data', audio: null });
                }
                return;
            }

            const { originalQuery, selectedItem } = payload;

            const contextQuery = `The user said "${originalQuery}" and selected a ${selectedItem.type} named "${selectedItem.name}". The full path is "${selectedItem.path}". Based on the original request, what action should I take? If the user was searching for something to open/launch, open it. If they wanted to find/locate it, show it in the folder. Respond with the action to take.`;

            const rawResponse = await llm.sendQuery(contextQuery, null, 'voice');
            const { cleanResponse, results } = await processor.processResponse(rawResponse);

            let actionTaken = false;
            let finalResponse = cleanResponse;

            if (results && results.length > 0) {
                for (const res of results) {
                    if (res.actionName === 'openFile' || res.actionName === 'launchApplication') {
                        actionTaken = true;
                        break;
                    }
                }
            }

            if (!actionTaken) {
                let openError = '';
                if (selectedItem.type === 'app') {
                    if (selectedItem.data && selectedItem.data.path) {
                        openError = await shell.openPath(selectedItem.data.path);
                    } else {
                        try {
                            const launchResult = await processor.launchApplication(selectedItem.name);
                            if (launchResult && (launchResult.startsWith('Error') || launchResult.startsWith('Could not'))) {
                                openError = launchResult;
                            }
                        } catch (err) {
                            openError = err.message || 'Failed to launch application';
                        }
                    }
                }

                if (selectedItem.type !== 'app' || (selectedItem.type === 'app' && openError)) {
                    if (selectedItem.path) {
                        const rawPath = selectedItem.path;
                        const itemPath = path.isAbsolute(rawPath)
                            ? rawPath
                            : path.join(os.homedir(), rawPath);
                        const normalizedItem = path.normalize(itemPath).toLowerCase();
                        const homeNorm = path.normalize(os.homedir()).toLowerCase();
                        const homePrefix = path.normalize(os.homedir() + path.sep).toLowerCase();
                        if (normalizedItem !== homeNorm && !normalizedItem.startsWith(homePrefix)) {
                            openError = 'Access denied: path escapes home directory';
                        } else {
                            openError = await shell.openPath(itemPath);
                        }
                    }
                }

                if (!openError) {
                    finalResponse = `Opening ${selectedItem.name}.`;
                } else {
                    console.error('[Main] Failed to open path:', openError);
                    finalResponse = `I couldn't open that item.`;
                }
            }

            if (!event.sender.isDestroyed()) {
                event.sender.send('action-complete');
                event.sender.send('voice-response', { text: finalResponse, audio: null });
            }

            if (ttsService.isAvailable() && finalResponse.length > 0) {
                ttsService
                    .synthesizeToDataURL(finalResponse)
                    .then((audioDataUrl) => {
                        if (!event.sender.isDestroyed()) {
                            event.sender.send('voice-audio-ready', audioDataUrl);
                        }
                    })
                    .catch((err) => { console.error('[Main] TTS synthesis failed:', err.message); });
            }
        } catch (error) {
            logger.error(`[voice] voice-file-action error: ${error.message}`);
            if (!event.sender.isDestroyed()) {
                event.sender.send('voice-response', { text: `Error: ${error.message}`, audio: null });
            }
        }
    });

    ipcMain.on('voice-audio', async (event, data) => {
        try {
            const { buffer, mimeType } = data;
            const audioBuffer = Buffer.from(buffer);

            const transcribedText = await ttsService.transcribe(audioBuffer, {
                filename: 'audio.webm',
                contentType: mimeType || 'audio/webm',
            });

            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('stt-result', transcribedText);
            }
        } catch (error) {
            logger.error(`[voice] Voice audio processing error: ${error.message}`);
            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('stt-result', '');
            }
        }
    });

    ipcMain.on('capture-region', async (event) => {
        try {
            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width: 1920, height: 1080 },
            });
            if (sources.length > 0) {
                const imageData = sources[0].thumbnail.toDataURL();
                if (!event.sender.isDestroyed()) {
                    event.sender.send('screen-captured', imageData);
                }
            }
        } catch (error) {
            logger.error(`[voice] Region capture failed: ${error.message}`);
        }
    });

    ipcMain.on('capture-screen', async (event) => {
        try {
            if (!cachedScreenCapture) {
                await captureScreenForVoice();
            }
            if (cachedScreenCapture && !event.sender.isDestroyed()) {
                event.sender.send('screen-captured', cachedScreenCapture);
            }
        } catch (error) {
            logger.error(`[voice] Handle capture error: ${error.message}`);
        }
    });
}

module.exports = { register, captureScreenForVoice };
