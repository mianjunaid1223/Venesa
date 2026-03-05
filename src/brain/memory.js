/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Memory
 *  File-backed structured memory with 4 buckets.
 *
 *  Governance Contract v2.0:
 *    All memory writes must be explicit via mutate().
 *    Mutation contract: { bucket, operation: 'set'|'append'|'remove', key, value }
 *    No implicit memory writing.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger
 *  USED BY:    brain/llm, brain/system-prompt, skills/core/manage-commands
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

const MEMORY_DIR = require('../lib/paths').getMemoryPath();
const BUCKETS = ['preferences', 'history', 'aliases', 'context'];

// In-memory cache
const data = {};

const saveQueue = {};

async function ensureDirAsync() {
    if (!fs.existsSync(MEMORY_DIR)) {
        await fs.promises.mkdir(MEMORY_DIR, { recursive: true });
    }
}

function ensureDir() {
    if (!fs.existsSync(MEMORY_DIR)) {
        fs.mkdirSync(MEMORY_DIR, { recursive: true });
    }
}

function bucketPath(bucket) {
    return path.join(MEMORY_DIR, `${bucket}.json`);
}

function loadBucket(bucket) {
    try {
        const filePath = bucketPath(bucket);
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8').trim();
            if (raw) {
                data[bucket] = JSON.parse(raw);
                return;
            }
        }
    } catch (e) {
        logger.error(`Failed to load memory bucket '${bucket}': ${e.message}`);
    }
    data[bucket] = {};
}

async function doSaveBucket(bucket) {
    try {
        await ensureDirAsync();
        await fs.promises.writeFile(bucketPath(bucket), JSON.stringify(data[bucket], null, 2), 'utf8');
    } catch (e) {
        logger.error(`Failed to save memory bucket '${bucket}': ${e.message}`);
    }
}

function saveBucket(bucket) {
    if (saveQueue[bucket]) return;
    saveQueue[bucket] = true;
    setTimeout(async () => {
        await doSaveBucket(bucket);
        saveQueue[bucket] = false;
    }, 50);
}

// ── Public API ──────────────────────────────────────────────

function load() {
    ensureDir();
    for (const bucket of BUCKETS) {
        loadBucket(bucket);
    }
    logger.info('Memory engine loaded');
}

function get(bucket, key) {
    if (!BUCKETS.includes(bucket)) return undefined;
    if (!data[bucket]) loadBucket(bucket);
    return key ? data[bucket][key] : data[bucket];
}

function set(bucket, key, value) {
    if (!BUCKETS.includes(bucket)) return false;
    if (!data[bucket]) loadBucket(bucket);
    data[bucket][key] = value;
    saveBucket(bucket);
    return true;
}

function list(bucket) {
    if (!BUCKETS.includes(bucket)) return [];
    if (!data[bucket]) loadBucket(bucket);
    return Object.keys(data[bucket]);
}

function remove(bucket, key) {
    if (!BUCKETS.includes(bucket)) return false;
    if (!data[bucket]) loadBucket(bucket);
    delete data[bucket][key];
    saveBucket(bucket);
    return true;
}

function clear(bucket) {
    if (!BUCKETS.includes(bucket)) return false;
    data[bucket] = {};
    saveBucket(bucket);
    return true;
}

function getSummary() {
    const sections = [];

    // Preferences
    const prefs = get('preferences') || {};
    if (Object.keys(prefs).length > 0) {
        const items = Object.entries(prefs).map(([k, v]) => `- ${k}: ${v}`).join('\n');
        sections.push(`### Preferences\n${items}`);
    }

    // Context (persistent facts)
    const ctx = get('context') || {};
    if (Object.keys(ctx).length > 0) {
        const items = Object.entries(ctx)
            .filter(([k, v]) => k !== 'personality')
            .map(([k, v]) => `- ${k}: ${v}`).join('\n');
        if (items) sections.push(`### About the User\n${items}`);
    }

    // Aliases
    const aliases = get('aliases') || {};
    if (Object.keys(aliases).length > 0) {
        const items = Object.entries(aliases).map(([k, v]) => `- "${k}" → ${v}`).join('\n');
        sections.push(`### Aliases\n${items}`);
    }

    // Personality summary (migrated from user-profile)
    if (ctx.personality) {
        sections.push(`### Personality Profile\n${ctx.personality}`);
    }

    return sections.length > 0 ? sections.join('\n\n') : '';
}

// ── History helpers ────────────────────────────────────────

const MAX_INTERACTIONS = 30;

function addInteraction(query, response, rawResponse) {
    get('history'); // ensure data.history is loaded
    if (!data.history) data.history = {};
    if (!Array.isArray(data.history.recent)) data.history.recent = [];
    const entry = { q: query, a: response, t: Date.now() };
    if (rawResponse && rawResponse !== response) entry.r = rawResponse;
    data.history.recent.push(entry);
    if (data.history.recent.length > MAX_INTERACTIONS) {
        data.history.recent = data.history.recent.slice(-MAX_INTERACTIONS);
    }
    data.history.interactionCount = (data.history.interactionCount || 0) + 1;
    saveBucket('history');
}

// ── Custom-commands helpers (backwards compat) ─────────────

function getCustomCommands() {
    const cmds = get('aliases', 'customCommands');
    if (!Array.isArray(cmds)) return [];

    let mutated = false;
    for (const c of cmds) {
        if (!c || !c.trigger) continue;
        if (typeof c.actions !== 'string') {
            try {
                c.actions = JSON.stringify(c.actions);
            } catch (e) {
                c.actions = String(c.actions);
            }
            mutated = true;
        }
    }

    const validCmds = cmds.filter(c => c && c.trigger && c.actions != null);
    if (mutated) {
        set('aliases', 'customCommands', validCmds);
    }
    return validCmds;
}

function addCustomCommand(trigger, actions, description) {
    const cmds = getCustomCommands();
    const existing = cmds.findIndex(c => c.trigger.toLowerCase() === trigger.toLowerCase());

    let normalizedActions = actions;
    if (typeof normalizedActions !== 'string') {
        try { normalizedActions = JSON.stringify(normalizedActions); } catch (e) { normalizedActions = String(normalizedActions); }
    }

    const cmd = { trigger, actions: normalizedActions, description: description || '' };
    if (existing >= 0) {
        cmds[existing] = cmd;
    } else {
        cmds.push(cmd);
    }
    set('aliases', 'customCommands', cmds);
    return { success: true };
}

function removeCustomCommand(trigger) {
    const cmds = getCustomCommands();
    const filtered = cmds.filter(c => c.trigger.toLowerCase() !== trigger.toLowerCase());
    if (filtered.length === cmds.length) {
        return { success: false, error: 'Command not found' };
    }
    set('aliases', 'customCommands', filtered);
    return { success: true };
}

// ── Corrupted capability helpers ───────────────────────────

/**
 * Mark a capability as corrupted with a human-readable reason.
 * Stored in aliases bucket under the key 'corruptedCapabilities'.
 */
function markCorrupted(name, reason) {
    try {
        const map = get('aliases', 'corruptedCapabilities') || {};
        map[name] = reason || 'Unknown error';
        set('aliases', 'corruptedCapabilities', map);
    } catch (e) {
        logger.error(`[memory] markCorrupted failed for '${name}': ${e.message}`);
    }
}

/**
 * Clear the corrupted flag for a capability.
 */
function clearCorrupted(name) {
    try {
        const map = get('aliases', 'corruptedCapabilities') || {};
        if (map[name]) {
            delete map[name];
            set('aliases', 'corruptedCapabilities', map);
        }
    } catch (e) {
        logger.error(`[memory] clearCorrupted failed for '${name}': ${e.message}`);
    }
}

/**
 * Return the full corrupted capabilities map.
 * @returns {{ [capabilityName: string]: string }}
 */
function getCorruptedMap() {
    try {
        return get('aliases', 'corruptedCapabilities') || {};
    } catch (e) {
        logger.error(`[memory] getCorruptedMap error: ${e.message}`);
        return {};
    }
}

function getCustomCommandsPromptSection() {
    const cmds = getCustomCommands();
    if (cmds.length === 0) return '';
    const list = cmds.map(c => {
        let actionsStr = c.actions;
        if (typeof actionsStr !== 'string') {
            try { actionsStr = JSON.stringify(actionsStr); } catch (e) { actionsStr = String(actionsStr); }
        }
        const safeTrigger = String(c.trigger).replace(/[\n#]/g, '');
        return `- "${safeTrigger}" → YOU MUST EMIT THE FOLLOWING EXACTLY AS WRITTEN:\n\`\`\`\n${actionsStr}\n\`\`\``;
    }).join('\n');
    return `\n## CUSTOM COMMANDS (user-created shortcuts)\nWhen the user says one of these triggers exactly, do NOT just say "Done". YOU MUST emit the EXACT action tags listed below:\n${list}\n`;
}

// ── Explicit Mutation Contract ─────────────────────────────
// All memory writes should go through mutate() to enforce
// the governance contract: { bucket, operation, key, value }
// operation must be one of: 'set', 'append', 'remove'

function mutate({ bucket, operation, key, value }) {
    if (!BUCKETS.includes(bucket)) {
        logger.error(`[memory] mutate: unknown bucket '${bucket}'`);
        return false;
    }
    if (!key || typeof key !== 'string') {
        logger.error(`[memory] mutate: key must be a non-empty string`);
        return false;
    }

    switch (operation) {
        case 'set':
            return set(bucket, key, value);

        case 'append': {
            if (!data[bucket]) loadBucket(bucket);
            const current = data[bucket][key];
            if (Array.isArray(current)) {
                current.push(value);
                saveBucket(bucket);
                return true;
            }
            if (current === undefined || current === null) {
                return set(bucket, key, [value]);
            }
            return set(bucket, key, [current, value]);
        }

        case 'remove':
            return remove(bucket, key);

        default:
            logger.error(`[memory] mutate: unknown operation '${operation}'. Must be set|append|remove`);
            return false;
    }
}

module.exports = {
    load,
    get,
    set,
    list,
    remove,
    clear,
    mutate,
    getSummary,
    addInteraction,
    getCustomCommands,
    addCustomCommand,
    removeCustomCommand,
    getCustomCommandsPromptSection,
    markCorrupted,
    clearCorrupted,
    getCorruptedMap,
    BUCKETS,
};
