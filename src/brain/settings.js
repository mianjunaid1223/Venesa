/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Settings
 *  Single source of truth for user settings (persisted to disk).
 * ═══════════════════════════════════════════════════════════════
 *  USED BY: brain/llm, platform/ipc/system-handlers
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');

const SETTINGS_PATH = require('../lib/paths').getSettingsPath();

const DEFAULTS = {
    modelName: 'gemini-2.5-flash-lite',
    userName: 'User',
    openAtLogin: true,
    voiceId: 'pFZP5JQG7iQjIQuC4Bku',
    ttsModel: 'eleven_flash_v2_5',
    wakeWordEnabled: true,
};

function load() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
            return { ...DEFAULTS, ...data };
        }
    } catch (e) {
        logger.error(`Failed to load settings: ${e.message}`);
    }
    return { ...DEFAULTS };
}

function save(patch) {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const current = load();
        const merged = { ...current, ...patch };
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2));
        return true;
    } catch (e) {
        logger.error(`Failed to save settings: ${e.message}`);
        return false;
    }
}

module.exports = { load, save, DEFAULTS, SETTINGS_PATH };
