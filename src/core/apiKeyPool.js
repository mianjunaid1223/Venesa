const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const ENV_PATH = path.join(process.cwd(), '.env');

// Simplified pool with primary/candidate system - no runtime validation
const pool = {
    gemini: { 
        keys: [],
        primary: null,      // Main key to use
        candidate: null,    // Backup if primary rate limited
        currentIndex: 0
    },
    elevenlabs: { 
        keys: [],
        primary: null,
        candidate: null,
        currentIndex: 0
    }
};

let initialized = false;

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

// Fast validation - just check if key format is valid + quick API ping
async function quickValidateGemini(key) {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        await model.generateContent('1');
        return { valid: true, key };
    } catch (e) {
        const msg = e.message || '';
        // 429 = rate limited but key is valid
        if (e.status === 429 || msg.includes('429') || msg.includes('quota')) {
            return { valid: true, rateLimited: true, key };
        }
        // Auth errors = invalid key
        if (e.status === 401 || e.status === 403 || msg.includes('API key')) {
            return { valid: false, key };
        }
        // Network errors - assume key is valid
        return { valid: true, key };
    }
}

async function quickValidateElevenLabs(key) {
    try {
        const response = await fetch('https://api.elevenlabs.io/v1/models', {
            headers: { 'xi-api-key': key }
        });
        return { valid: response.ok || response.status === 429, key };
    } catch (e) {
        // Network error - assume valid
        return { valid: true, key };
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
    
    logger.info(`Found ${geminiCount} Gemini keys, ${elevenCount} ElevenLabs keys - validating in parallel...`);

    // PARALLEL validation - all at once, no delays
    const [geminiResults, elevenLabsResults] = await Promise.all([
        Promise.all(pool.gemini.keys.map(quickValidateGemini)),
        Promise.all(pool.elevenlabs.keys.map(quickValidateElevenLabs))
    ]);

    // Select primary and candidate for Gemini
    const validGemini = geminiResults.filter(r => r.valid);
    const availableGemini = validGemini.filter(r => !r.rateLimited);
    const rateLimitedGemini = validGemini.filter(r => r.rateLimited);
    
    if (availableGemini.length > 0) {
        pool.gemini.primary = availableGemini[0].key;
        pool.gemini.candidate = availableGemini[1]?.key || rateLimitedGemini[0]?.key || null;
    } else if (rateLimitedGemini.length > 0) {
        // All keys rate limited - pick first two, they'll recover
        pool.gemini.primary = rateLimitedGemini[0].key;
        pool.gemini.candidate = rateLimitedGemini[1]?.key || null;
        logger.warn('All Gemini keys are currently rate limited - will retry with them');
    }
    
    pool.gemini.keys = validGemini.map(r => r.key);

    // Select primary and candidate for ElevenLabs  
    const validEleven = elevenLabsResults.filter(r => r.valid);
    if (validEleven.length > 0) {
        pool.elevenlabs.primary = validEleven[0].key;
        pool.elevenlabs.candidate = validEleven[1]?.key || null;
    }
    pool.elevenlabs.keys = validEleven.map(r => r.key);

    initialized = true;
    
    logger.info(`Key pool ready - Gemini: ${pool.gemini.keys.length} valid (primary: ${maskKey(pool.gemini.primary)}), ElevenLabs: ${pool.elevenlabs.keys.length} valid`);
    
    return true;
}

// Fast key getter - no validation, just return primary or rotate
function getNextKey(service) {
    if (!service || typeof service !== 'string') return null;
    if (!initialized) {
        logger.warn('Key pool not initialized');
        return null;
    }

    service = service.toLowerCase();
    const s = pool[service];
    if (!s || s.keys.length === 0) return null;

    // Return primary if available
    if (s.primary) return s.primary;
    
    // Fallback: round-robin through all keys
    const key = s.keys[s.currentIndex];
    s.currentIndex = (s.currentIndex + 1) % s.keys.length;
    return key;
}

function reportSuccess(service, key) {
    // Promote successful key to primary if it wasn't
    if (!service || typeof service !== 'string') return;
    service = service.toLowerCase();
    const s = pool[service];
    if (s && key && s.primary !== key) {
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
    
    // Check for rate limit (429)
    const isRateLimit = status === 429 || errorMsg.includes('429') || 
                        errorMsg.includes('quota') || errorMsg.includes('rate');
    
    if (isRateLimit) {
        logger.warn(`Rate limited key: ${maskKey(key)}`);
        // Swap to candidate
        if (s.primary === key && s.candidate) {
            logger.info(`Swapping to candidate key: ${maskKey(s.candidate)}`);
            const temp = s.primary;
            s.primary = s.candidate;
            s.candidate = temp;
        } else if (s.keys.length > 1) {
            // Rotate to next key
            s.currentIndex = (s.currentIndex + 1) % s.keys.length;
            s.primary = s.keys[s.currentIndex];
            logger.info(`Rotated to next key: ${maskKey(s.primary)}`);
        }
        return { keyHandled: true, action: 'rotated' };
    }
    
    // Check for auth errors (401/403)
    const isAuthError = (status === 401 || status === 403) ||
        errorMsg.includes('401') || errorMsg.includes('403') || 
        errorMsg.includes('API key') || errorMsg.includes('authentication');

    if (isAuthError) {
        logger.warn(`Removing invalid key: ${maskKey(key)}`);
        s.keys = s.keys.filter(k => k !== key);
        if (s.primary === key) {
            s.primary = s.candidate || s.keys[0] || null;
            s.candidate = s.keys.length > 1 ? s.keys[1] : null;
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
    return pool[service] && pool[service].keys.length > 0;
}

function getStats() {
    return {
        gemini: pool.gemini.keys.length,
        elevenlabs: pool.elevenlabs.keys.length,
        geminiPrimary: maskKey(pool.gemini.primary),
        elevenLabsPrimary: maskKey(pool.elevenlabs.primary)
    };
}

module.exports = {
    initialize,
    getNextKey,
    hasKeys,
    reportSuccess,
    reportError,
    getStats,
    isHealthy: () => pool.gemini.keys.length > 0 || pool.elevenlabs.keys.length > 0
};
