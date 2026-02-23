/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: LLM
 *  Gemini API client — sends queries, manages chat sessions.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, lib/key-pool, brain/memory,
 *              brain/services.config, brain/system-prompt
 * ═══════════════════════════════════════════════════════════════
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const logger = require('../lib/logger');
const keyPool = require("../lib/key-pool");
const memory = require("./memory");
const settings = require("./settings");

let genAI = null;
let activeKey = null;
let systemPromptCache = { text: null, voice: null };

async function initializeAPI() {
    const apiKey = keyPool.getNextKey('gemini');
    if (!apiKey) {
        await keyPool.initialize();
        const retryKey = keyPool.getNextKey('gemini');
        if (!retryKey) {
            logger.error('No valid Gemini API keys found.');
            throw new Error('No valid Gemini API keys found.');
        }
        activeKey = retryKey;
        genAI = new GoogleGenerativeAI(activeKey);
    } else {
        activeKey = apiKey;
        genAI = new GoogleGenerativeAI(activeKey);
    }

    systemPromptCache = { text: null, voice: null };
    logger.info('LLM API initialized');
}

function needsSetup() {
    const fs = require('fs');
    return !keyPool.hasKeys('gemini') || !fs.existsSync(settings.SETTINGS_PATH);
}

function getModel(mode = 'text') {
    if (!genAI) {
        throw new Error('LLM not initialized. genAI is missing. Call initializeAPI() before getModel().');
    }
    const s = settings.load();
    const servicesConfig = require('./services.config');
    const getSystemPrompt = require('./system-prompt');

    if (!systemPromptCache[mode]) {
        systemPromptCache[mode] = getSystemPrompt(s.userName, mode);
    }

    return genAI.getGenerativeModel({
        model: s.modelName || servicesConfig.gemini.model,
        systemInstruction: systemPromptCache[mode],
        generationConfig: servicesConfig.gemini.generationConfig,
        safetySettings: servicesConfig.gemini.safetySettings,
    });
}

function createFreshChat(mode = 'text') {
    const model = getModel(mode);
    return model.startChat({ history: [] });
}

async function sendQuery(query, imageData = null, mode = 'text') {
    if (!genAI) {
        throw new Error('LLM not initialized');
    }

    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const chat = createFreshChat(mode);
            let result;

            if (imageData) {
                // Accepted imageData format: Full data URI, "base64," prefix, or raw base64 string.
                let mimeType = 'application/octet-stream';
                let base64Data = imageData;
                const dataUriMatch = imageData.match(/^data:([^;]+);base64,(.*)$/);

                if (dataUriMatch) {
                    mimeType = dataUriMatch[1];
                    base64Data = dataUriMatch[2];
                } else if (imageData.startsWith('base64,')) {
                    base64Data = imageData.substring(7);
                } else if (imageData.includes(',')) {
                    base64Data = imageData.split(',')[1];
                } else {
                    const cleanData = imageData.replace(/\s/g, '');
                    if (cleanData.length >= 64 && cleanData.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(cleanData)) {
                        base64Data = cleanData;
                        logger.warn('Falling back to raw base64 string for image data');
                    } else {
                        logger.warn(
                            `[LLM] base64 validation failed for imageData — ` +
                            `len=${cleanData.length}, mod4=${cleanData.length % 4}, ` +
                            `first4=${cleanData.slice(0, 4)}, last4=${cleanData.slice(-4)}. ` +
                            `Dropping image to prevent invalid API request.`
                        );
                        base64Data = null;
                    }
                }

                result = await chat.sendMessage([
                    query,
                    {
                        inlineData: {
                            mimeType,
                            data: base64Data,
                        },
                    },
                ]);
            } else {
                result = await chat.sendMessage(query);
            }

            const responseText = result.response.text();
            if (activeKey) keyPool.reportSuccess('gemini', activeKey);



            return responseText;

        } catch (error) {
            lastError = error;
            logger.error(`LLM query failed (attempt ${attempt + 1}): ${error.message}`);

            if (activeKey) {
                const { keyHandled } = keyPool.reportError('gemini', activeKey, error);
                if (keyHandled) {
                    activeKey = keyPool.getNextKey('gemini');
                    if (activeKey) {
                        genAI = new GoogleGenerativeAI(activeKey);
                        systemPromptCache[mode] = null;
                    }
                }
            }


        }
    }

    throw lastError || new Error('Query failed after retries');
}

module.exports = {
    initializeAPI,
    sendQuery,
    needsSetup,
};
