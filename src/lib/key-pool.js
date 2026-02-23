/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Key Pool
 *  Round-robin API-key rotation with rate-limit handling.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, lib/paths
 *  USED BY:    brain/llm, platform/speech/tts
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const paths = require('./paths');

const ENV_PATH = paths.getEnvPath();

const pool = {
    gemini: {
        keys: [],
        primary: null,
        candidate: null,
        rateLimitedUntil: new Map()
    },
    elevenlabs: {
        keys: [],
        primary: null,
        candidate: null,
        rateLimitedUntil: new Map()
    }
};

let initialized = false;
/**
 * `keysLoaded` is set by hasKeys() after a quick synchronous env read.
 * `initialized` is set only by the full async initialize() that validates keys over the network.
 * getNextKey() gates on `initialized` so unvalidated, env-loaded keys are never
 * silently promoted to primary/candidate.
 */
let keysLoaded = false;

function loadKeysFromEnv() {
    if (!fs.existsSync(ENV_PATH)) return;

    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const lines = content.split('\n');

    pool.gemini.keys = [];
    pool.elevenlabs.keys = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        if (trimmed.match(/^GEMINI_API_KEY(?:_\d+)?\s*=/)) {
            const key = trimmed.substring(trimmed.indexOf('=') + 1).trim().replace(/["']/g, '');
            if (key) pool.gemini.keys.push(key);
        }

        if (trimmed.match(/^ELEVENLABS_API_KEY(?:_\d+)?\s*=/)) {
            const key = trimmed.substring(trimmed.indexOf('=') + 1).trim().replace(/["']/g, '');
            if (key) pool.elevenlabs.keys.push(key);
        }
    });
}

async function validateGeminiKey(key) {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
        await model.generateContent('hi');
        return { status: 'working', key };
    } catch (e) {
        const msg = e.message || '';
        const status = e.status;
        if (status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate')) {
            return { status: 'rate_limited', key };
        }
        if (status === 401 || status === 403 || msg.includes('API key') || msg.includes('authentication')) {
            return { status: 'invalid', key };
        }
        return { status: 'unverified', key };
    }
}

async function validateElevenLabsKey(key) {
    let timeout;
    try {
        const controller = new AbortController();
        timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('https://api.elevenlabs.io/v1/models', {
            headers: { 'xi-api-key': key },
            signal: controller.signal
        });
        if (response.ok) return { status: 'working', key };
        if (response.status === 429) return { status: 'rate_limited', key };
        if (response.status === 401 || response.status === 403) return { status: 'invalid', key };
        return { status: 'unverified', key };
    } catch (e) {
        return { status: 'unverified', key };
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}

function maskKey(key) {
    return key ? `${key.substring(0, 8)}...` : 'null';
}

async function initialize() {
    logger.info('Initializing API key pool');
    loadKeysFromEnv();

    const geminiCount = pool.gemini.keys.length;
    const elevenCount = pool.elevenlabs.keys.length;

    logger.info(`Found ${geminiCount} Gemini keys, ${elevenCount} ElevenLabs keys - validating...`);

    const processInBatches = async (items, fn, batchSize = 3) => {
        const results = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const batchResults = await Promise.all(batch.map(fn));
            results.push(...batchResults);
            if (i + batchSize < items.length) await new Promise(r => setTimeout(r, 1000));
        }
        return results;
    };

    const geminiResults = await processInBatches(pool.gemini.keys, validateGeminiKey);
    const elevenLabsResults = await processInBatches(pool.elevenlabs.keys, validateElevenLabsKey);

    const workingGemini = geminiResults.filter(r => r.status === 'working').map(r => r.key);
    const rateLimitedGemini = geminiResults.filter(r => r.status === 'rate_limited').map(r => r.key);
    const unverifiedGemini = geminiResults.filter(r => r.status === 'unverified').map(r => r.key);
    const validGemini = [...workingGemini, ...rateLimitedGemini, ...unverifiedGemini];

    if (workingGemini.length > 0) {
        pool.gemini.primary = workingGemini[0];
        pool.gemini.candidate = workingGemini[1] || rateLimitedGemini[0] || unverifiedGemini[0] || null;
        logger.info(`Gemini primary: ${maskKey(pool.gemini.primary)} (working)`);
    } else if (rateLimitedGemini.length > 0) {
        pool.gemini.primary = rateLimitedGemini[0];
        pool.gemini.candidate = rateLimitedGemini[1] || unverifiedGemini[0] || null;
        logger.warn(`All Gemini keys rate limited - using ${maskKey(pool.gemini.primary)}`);
        rateLimitedGemini.forEach(key => {
            pool.gemini.rateLimitedUntil.set(key, Date.now() + 60000);
        });
    } else if (unverifiedGemini.length > 0) {
        pool.gemini.primary = unverifiedGemini[0];
        pool.gemini.candidate = unverifiedGemini[1] || null;
    }
    pool.gemini.keys = validGemini;

    const workingEleven = elevenLabsResults.filter(r => r.status === 'working').map(r => r.key);
    const rateLimitedEleven = elevenLabsResults.filter(r => r.status === 'rate_limited').map(r => r.key);
    const unverifiedEleven = elevenLabsResults.filter(r => r.status === 'unverified').map(r => r.key);
    const validEleven = [...workingEleven, ...rateLimitedEleven, ...unverifiedEleven];

    if (workingEleven.length > 0) {
        pool.elevenlabs.primary = workingEleven[0];
        pool.elevenlabs.candidate = workingEleven[1] || rateLimitedEleven[0] || unverifiedEleven[0] || null;
    } else if (rateLimitedEleven.length > 0) {
        pool.elevenlabs.primary = rateLimitedEleven[0];
        pool.elevenlabs.candidate = rateLimitedEleven[1] || unverifiedEleven[0] || null;
    } else if (unverifiedEleven.length > 0) {
        pool.elevenlabs.primary = unverifiedEleven[0];
        pool.elevenlabs.candidate = unverifiedEleven[1] || null;
    }
    pool.elevenlabs.keys = validEleven;

    initialized = true;
    logger.info(`Key pool ready - Gemini: ${validGemini.length} valid (${workingGemini.length} working), ElevenLabs: ${validEleven.length} valid`);
    return true;
}

function getNextKey(service) {
    if (!service || typeof service !== 'string') return null;
    if (!initialized) {
        logger.warn('Key pool not initialized');
        return null;
    }
    service = service.toLowerCase();
    const s = pool[service];
    if (!s || s.keys.length === 0) return null;
    const now = Date.now();

    if (s.primary) {
        const rateLimitExpiry = s.rateLimitedUntil.get(s.primary);
        if (!rateLimitExpiry || now >= rateLimitExpiry) {
            s.rateLimitedUntil.delete(s.primary);
            return s.primary;
        }
    }

    if (s.candidate) {
        const rateLimitExpiry = s.rateLimitedUntil.get(s.candidate);
        if (!rateLimitExpiry || now >= rateLimitExpiry) {
            s.rateLimitedUntil.delete(s.candidate);
            const temp = s.primary;
            s.primary = s.candidate;
            s.candidate = temp;
            logger.info(`Swapped to candidate key: ${maskKey(s.primary)}`);
            return s.primary;
        }
    }

    for (const key of s.keys) {
        const rateLimitExpiry = s.rateLimitedUntil.get(key);
        if (!rateLimitExpiry || now >= rateLimitExpiry) {
            s.rateLimitedUntil.delete(key);
            s.primary = key;
            logger.info(`Found available key: ${maskKey(key)}`);
            return key;
        }
    }

    logger.warn(`All ${service} keys rate limited, returning primary anyway`);
    return s.primary;
}

function reportSuccess(service, key) {
    if (!service || typeof service !== 'string') return;
    service = service.toLowerCase();
    const s = pool[service];
    if (!s || !key) return;
    s.rateLimitedUntil.delete(key);
    if (s.primary !== key) {
        s.candidate = s.primary;
        s.primary = key;
    }
}

function reportError(service, key, error) {
    if (!service || typeof service !== 'string') return { keyHandled: false };
    service = service.toLowerCase();
    const s = pool[service];
    if (!s) return { keyHandled: false };

    const errorMsg = error?.message || '';
    const status = error?.status;

    const isRateLimit = status === 429 || errorMsg.includes('429') ||
        errorMsg.includes('quota') || errorMsg.includes('rate');

    if (isRateLimit) {
        logger.warn(`Rate limited: ${maskKey(key)} - cooling down 60s`);
        s.rateLimitedUntil.set(key, Date.now() + 60000);

        const now = Date.now();
        for (const k of s.keys) {
            if (k !== key) {
                const expiry = s.rateLimitedUntil.get(k);
                if (!expiry || now >= expiry) {
                    s.rateLimitedUntil.delete(k);
                    s.candidate = s.primary;
                    s.primary = k;
                    logger.info(`Rotated to available key: ${maskKey(k)}`);
                    return { keyHandled: true, action: 'rotated', newKey: k };
                }
            }
        }
        return { keyHandled: true, action: 'marked_rate_limited' };
    }

    const isAuthError = (status === 401 || status === 403) ||
        errorMsg.includes('401') || errorMsg.includes('403') ||
        errorMsg.includes('API key') || errorMsg.includes('authentication') ||
        errorMsg.includes('leaked') || errorMsg.includes('revoked') || errorMsg.includes('disabled');

    if (isAuthError) {
        logger.warn(`Removing invalid key: ${maskKey(key)}`);
        s.keys = s.keys.filter(k => k !== key);
        s.rateLimitedUntil.delete(key);
        if (s.primary === key) {
            s.primary = s.candidate || s.keys[0] || null;
            s.candidate = s.keys.find(k => k !== s.primary) || null;
        }
        if (s.candidate === key) {
            s.candidate = s.keys.find(k => k !== s.primary) || null;
        }
        return { keyHandled: true, action: 'removed' };
    }

    return { keyHandled: false };
}

function hasKeys(service) {
    if (!service || typeof service !== 'string') return false;
    service = service.toLowerCase();

    // Quick synchronous check — loads from .env but does NOT run network validation.
    // Use keysLoaded (not initialized) so that getNextKey() still requires full
    // initialize() before treating keys as validated primary/candidate.
    if (!keysLoaded && pool[service] && pool[service].keys.length === 0) {
        loadKeysFromEnv();
        keysLoaded = true;
    }

    return pool[service] && pool[service].keys.length > 0;
}

function getStats() {
    return {
        gemini: pool.gemini.keys.length,
        elevenlabs: pool.elevenlabs.keys.length,
        geminiPrimary: maskKey(pool.gemini.primary),
        elevenLabsPrimary: maskKey(pool.elevenlabs.primary),
        geminiRateLimited: pool.gemini.rateLimitedUntil.size,
        elevenlabsRateLimited: pool.elevenlabs.rateLimitedUntil.size
    };
}

/**
 * Mark the pool as stale so the next getNextKey/hasKeys call
 * will re-read .env without doing full network validation.
 */
function invalidate() {
    initialized = false;
    pool.gemini.keys = [];
    pool.gemini.primary = null;
    pool.elevenlabs.keys = [];
    pool.elevenlabs.primary = null;
}

module.exports = {
    initialize,
    invalidate,
    getNextKey,
    hasKeys,
    reportSuccess,
    reportError,
    getStats,
    isHealthy: () => pool.gemini.keys.length > 0 || pool.elevenlabs.keys.length > 0
};
