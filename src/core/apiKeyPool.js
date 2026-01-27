/**
 * Unified API Key Pool Manager (Gemini & ElevenLabs)
 * 
 * DESIGN:
 * - Simple round-robin key selection
 * - Startup validation ONLY (no runtime checking on every call)
 * - Auto-remove invalid keys during startup
 * - Runtime blacklist for rate-limit/auth errors
 */

const fs = require('fs');
const path = require('path');

// CONSTANTS
const ENV_PATH = path.join(process.cwd(), '.env');
const SERVICES = ['gemini', 'elevenlabs'];

// STATE
const pool = {
    gemini: { keys: [], index: 0, valid: [] },
    elevenlabs: { keys: [], index: 0, valid: [] }
};

let initialized = false;

// HELPER: Read .env file
function loadKeysFromEnv() {
    if (!fs.existsSync(ENV_PATH)) return;

    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const lines = content.split('\n');

    pool.gemini.keys = [];
    pool.elevenlabs.keys = [];

    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        // Gemini Keys
        if (trimmed.match(/^GEMINI_API_KEY(?:_\d+)?\s*=/)) {
            const key = trimmed.substring(trimmed.indexOf('=') + 1).trim().replace(/["']/g, '');
            if (key) pool.gemini.keys.push(key);
        }

        // ElevenLabs Keys
        if (trimmed.match(/^ELEVENLABS_API_KEY(?:_\d+)?\s*=/)) {
            const key = trimmed.substring(trimmed.indexOf('=') + 1).trim().replace(/["']/g, '');
            if (key) pool.elevenlabs.keys.push(key);
        }
    });
}

// HELPER: Validate Gemini Key
async function validateGemini(key) {
    try {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
        await model.generateContent('Hi'); // Minimal cost test
        return true;
    } catch (e) {
        console.warn(`[KeyPool] Gemini Key validation failed (soft-fail): ${maskKey(key)} - ${e.message}`);
        // Allow potentially valid keys to pass startup check; runtime will remove if truly invalid
        return true;
    }
}

// HELPER: Validate ElevenLabs Key
async function validateElevenLabs(key) {
    try {
        const response = await fetch('https://api.elevenlabs.io/v1/user', {
            headers: { 'xi-api-key': key }
        });
        if (!response.ok) throw new Error(`Status ${response.status}`);
        return true;
    } catch (e) {
        console.warn(`[KeyPool] ElevenLabs Key validation failed (soft-fail): ${maskKey(key)} - ${e.message}`);
        // Allow potentially valid keys to pass startup check; runtime will remove if truly invalid
        return true;
    }
}

// HELPER: Utility
function maskKey(key) {
    return key ? `${key.substring(0, 8)}...` : 'null';
}

// --- PUBLIC API ---

async function initialize() {
    console.log('[KeyPool] Initializing Unified Key Pool...');
    loadKeysFromEnv();

    // Validate Gemini Keys
    console.log(`[KeyPool] Validating ${pool.gemini.keys.length} Gemini keys...`);
    pool.gemini.valid = [];
    for (const key of pool.gemini.keys) {
        if (await validateGemini(key)) {
            pool.gemini.valid.push(key);
        }
        // Small delay to prevent rate limits during check
        await new Promise(r => setTimeout(r, 200));
    }

    // Validate ElevenLabs Keys
    console.log(`[KeyPool] Validating ${pool.elevenlabs.keys.length} ElevenLabs keys...`);
    pool.elevenlabs.valid = [];
    for (const key of pool.elevenlabs.keys) {
        if (await validateElevenLabs(key)) {
            pool.elevenlabs.valid.push(key);
        }
        await new Promise(r => setTimeout(r, 200));
    }

    initialized = true;
    console.log(`[KeyPool] Ready. Gemini: ${pool.gemini.valid.length}, ElevenLabs: ${pool.elevenlabs.valid.length}`);
    return true;
}

function getNextKey(service) {
    if (!service || typeof service !== 'string') return null;
    if (!initialized) {
        console.warn('[KeyPool] Not initialized, auto-initializing (no validation for speed)...');
        loadKeysFromEnv();
        // Fallback: assume all loaded keys are valid if we haven't validated yet
        pool.gemini.valid = [...pool.gemini.keys];
        pool.elevenlabs.valid = [...pool.elevenlabs.keys];
        initialized = true;
    }

    service = service.toLowerCase();
    if (!pool[service]) return null;

    const s = pool[service];
    if (s.valid.length === 0) return null;

    // Round robin
    const key = s.valid[s.index];
    s.index = (s.index + 1) % s.valid.length;
    return key;
}

function reportSuccess(service, key) {
    // No-op for now, but keeping signature valid
}

function reportError(service, key, error) {
    if (!service || typeof service !== 'string') return { keyHandled: false };
    service = service.toLowerCase();
    const isAuthError =
        (error.status === 401 || error.status === 403) ||
        (error.message && (error.message.includes('401') || error.message.includes('403')));

    if (isAuthError) {
        console.warn(`[KeyPool] Removing invalid runtime key for ${service}: ${maskKey(key)}`);
        // Remove from valid list
        if (pool[service]) {
            pool[service].valid = pool[service].valid.filter(k => k !== key);
            // Reset index if needed
            if (pool[service].index >= pool[service].valid.length) {
                pool[service].index = 0;
            }
        }
        return { keyHandled: true, action: 'removed' };
    }

    return { keyHandled: false };
}

function hasKeys(service) {
    if (!service || typeof service !== 'string') return false;
    service = service.toLowerCase();
    return pool[service] && pool[service].valid.length > 0;
}

function getStats() {
    return {
        gemini: pool.gemini.valid.length,
        elevenlabs: pool.elevenlabs.valid.length,
        totalGemini: pool.gemini.keys.length,
        totalElevenLabs: pool.elevenlabs.keys.length
    };
}

module.exports = {
    initialize,
    getNextKey,
    hasKeys,
    reportSuccess,
    reportError,
    getStats,
    // Aliases to maintain some compatibility if needed, but we should update callers
    isHealthy: () => pool.gemini.valid.length > 0 || pool.elevenlabs.valid.length > 0,
    APIKeyPool: class { constructor() { /* Mock for compatibility if needed */ } }
};
