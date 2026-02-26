/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Key Store
 *  Plain-text API key management — reads and writes directly
 *  to the project .env file. No encryption.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, lib/paths
 *  USED BY:    lib/key-pool, platform/ipc/system-handlers
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const logger = require('./logger');
const paths = require('./paths');

const ENV_PATH = paths.getEnvPath();

const SERVICE_ENV_MAP = {
    gemini: 'GEMINI_API_KEY',
    elevenlabs: 'ELEVENLABS_API_KEY',
};

function maskKey(key) {
    if (!key || typeof key !== 'string') return '(none)';
    if (key.length <= 8) return '****';
    return `${key.substring(0, 4)}****${key.substring(key.length - 4)}`;
}

function readEnvFile() {
    try {
        if (fs.existsSync(ENV_PATH)) {
            return fs.readFileSync(ENV_PATH, 'utf8');
        }
    } catch (e) {
        logger.error(`Failed to read .env: ${e.message}`);
    }
    return '';
}

function getKeyFromEnv(envVar) {
    // Check process.env first (already loaded by dotenv at startup)
    if (process.env[envVar]) return process.env[envVar];
    // Fall back to reading file directly (e.g. after setKey was called this session)
    const content = readEnvFile();
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith(`${envVar}=`)) {
            const val = trimmed.slice(envVar.length + 1).replace(/^["']|["']$/g, '').trim();
            return val || null;
        }
    }
    return null;
}

function writeKeyToEnv(envVar, value) {
    try {
        const content = readEnvFile();
        const lines = content.split('\n');
        const idx = lines.findIndex(l => l.trim().startsWith(`${envVar}=`));

        if (idx >= 0) {
            if (value) {
                lines[idx] = `${envVar}=${value}`;
            } else {
                lines.splice(idx, 1);
            }
        } else if (value) {
            lines.push(`${envVar}=${value}`);
        }

        // Keep file clean — no blank lines at start, strip trailing blanks except one
        const cleaned = lines.join('\n').trimEnd();
        const contentToWrite = cleaned ? cleaned + '\n' : '';
        const tempPath = ENV_PATH + '.tmp.' + Date.now();
        fs.writeFileSync(tempPath, contentToWrite);
        fs.renameSync(tempPath, ENV_PATH);

        // Update process.env immediately so the pool reloads correctly
        if (value) {
            process.env[envVar] = value;
        } else {
            delete process.env[envVar];
        }
        return true;
    } catch (e) {
        logger.error(`Failed to write .env: ${e.message}`);
        return false;
    }
}

async function getKey(service) {
    const envVar = SERVICE_ENV_MAP[service];
    if (!envVar) return null;
    return getKeyFromEnv(envVar) || null;
}

/**
 * Return every stored key for a service (base + numbered slots).
 * e.g. GEMINI_API_KEY, GEMINI_API_KEY_2, GEMINI_API_KEY_3, ...
 */
function getAllServiceKeys(service) {
    const envVar = SERVICE_ENV_MAP[service];
    if (!envVar) return [];

    const content = readEnvFile();
    const re = new RegExp(`^(${envVar}(?:_\\d+)?)\\s*=\\s*(.+)$`);
    const results = [];

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        const match = trimmed.match(re);
        if (match) {
            const key = match[2].replace(/^["']|["']$/g, '').trim();
            if (key) results.push({ envVar: match[1], masked: maskKey(key) });
        }
    }
    return results;
}

/**
 * Append a new key as the next available numbered slot.
 * If GEMINI_API_KEY exists, the next slot is GEMINI_API_KEY_2, then _3, etc.
 * If no key exists yet, use the base name.
 */
async function addKey(service, newKey) {
    const envVar = SERVICE_ENV_MAP[service];
    if (!envVar || !newKey) return false;

    const existing = getAllServiceKeys(service);

    if (existing.length === 0) {
        // No key yet — use base slot
        return writeKeyToEnv(envVar, newKey);
    }

    // Find highest existing number
    const usedNums = existing.map(k => {
        const m = k.envVar.match(/_([0-9]+)$/);
        return m ? parseInt(m[1], 10) : 1; // base slot counts as 1
    });
    const nextNum = Math.max(...usedNums) + 1;
    return writeKeyToEnv(`${envVar}_${nextNum}`, newKey);
}

async function setKey(service, key) {
    const envVar = SERVICE_ENV_MAP[service];
    if (!envVar) return false;
    return writeKeyToEnv(envVar, key || null);
}

async function removeKey(service) {
    return setKey(service, null);
}

/**
 * Remove exactly one key entry by its env-var name (e.g. 'GEMINI_API_KEY_2').
 */
async function removeKeyByEnvVar(envVar) {
    if (!envVar) return false;
    try {
        const content = readEnvFile();
        const lines = content.split('\n');
        const idx = lines.findIndex(l => l.trim().startsWith(`${envVar}=`));
        if (idx >= 0) {
            lines.splice(idx, 1);
            const cleaned = lines.join('\n').trimEnd();
            fs.writeFileSync(ENV_PATH, cleaned ? cleaned + '\n' : '');
            delete process.env[envVar];
        }
        return true;
    } catch (e) {
        logger.error(`Failed to remove ${envVar}: ${e.message}`);
        return false;
    }
}

async function getKeyStatus() {
    // Collect specific keys
    const gemini = getAllServiceKeys('gemini');
    const elevenlabs = getAllServiceKeys('elevenlabs');

    // Collect all other keys in .env as "custom"
    const custom = [];
    const content = readEnvFile();
    const knownVars = [SERVICE_ENV_MAP.gemini, SERVICE_ENV_MAP.elevenlabs];

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.+)$/);
        if (match) {
            const envVar = match[1];
            // Skip known base vars and their numbered variants (_2, _3 etc)
            const isKnown = knownVars.some(base => envVar === base || envVar.startsWith(`${base}_`));
            if (!isKnown) {
                const keyVal = match[2].replace(/^["']|["']$/g, '').trim();
                custom.push({ envVar, masked: maskKey(keyVal) });
            }
        }
    }

    return {
        gemini,
        elevenlabs,
        custom
    };
}

module.exports = {
    maskKey,
    getKey,
    getKeyFromEnv,
    writeKeyToEnv,
    getAllServiceKeys,
    addKey,
    setKey,
    removeKey,
    removeKeyByEnvVar,
    getKeyStatus
};
