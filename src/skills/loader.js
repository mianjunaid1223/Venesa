/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill Loader
 *  Auto-discovers and registers skills from core/ and plugins/.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, skills/registry, skills/validator
 *  USED BY:    brain/processor (auto-loaded on first require)
 * ═══════════════════════════════════════════════════════════════
 *
 *  SKILL / PLUGIN STANDARD SCHEMA
 *  ──────────────────────────────
 *  module.exports = {
 *    name:        string,          // unique camelCase identifier
 *    description: string,          // shown in Settings and injected into AI prompt
 *    returns:     'data'|'none',   // 'data' = fetches info (AI waits for result), 'none' = performs action
 *    marker:      'silently'|'announce'|'confirm',  // execution feedback level
 *    ui:          string|null,     // optional: 'table'|'key-value'|'card-list'|'command-list'
 *    handler:     async (params) => any,  // REQUIRED — same contract for skills AND plugins
 *  };
 *
 *  Plugins live in /plugins/ and may also include:
 *    enabled:    boolean           // (optional) start disabled if false
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const registry = require('./registry');
const validator = require('./validator');

const CORE_DIR = path.join(__dirname, 'core');
const PLUGINS_DIR = path.join(__dirname, '../../plugins');

// ── Helpers ──────────────────────────────────────────────────

function isPluginEnabled(pluginName) {
    try {
        const memory = require('../brain/memory');
        const states = memory.get('aliases', 'pluginStates') || {};
        // Default to enabled unless explicitly set to false
        return states[pluginName] !== false;
    } catch {
        return true;
    }
}

function loadSkillFile(filePath, source = 'core') {
    try {
        if (require.cache[require.resolve(filePath)]) {
            delete require.cache[require.resolve(filePath)];
        }
        const skill = require(filePath);

        // Validate standard schema
        const result = validator.validate(skill, filePath);
        if (!result.valid) {
            logger.warn(`Skipping invalid skill at ${filePath}: ${result.errors.join(', ')}`);
            return false;
        }

        // For plugins: check enabled state
        if (source === 'plugin') {
            if (skill.enabled === false) {
                logger.debug(`Plugin '${skill.name}' is disabled by default — skipping`);
                return false;
            }
            if (!isPluginEnabled(skill.name)) {
                logger.debug(`Plugin '${skill.name}' is disabled by user — skipping`);
                return false;
            }
        }

        if (registry.has(skill.name)) {
            logger.warn(`Duplicate skill name '${skill.name}' in ${filePath} — skipping`);
            return false;
        }

        registry.register(skill.name, skill, source);
        return true;
    } catch (e) {
        logger.error(`Failed to load skill at ${filePath}: ${e.message}`);
        return false;
    }
}

function loadDirectory(dir, label) {
    if (!fs.existsSync(dir)) {
        logger.debug(`Skill directory not found: ${dir}`);
        return 0;
    }

    let loaded = 0;
    const files = fs.readdirSync(dir).filter(f =>
        f.endsWith('.js') && !f.startsWith('_')
    );

    for (const file of files) {
        const filePath = path.join(dir, file);
        if (loadSkillFile(filePath, 'core')) {
            loaded++;
        }
    }

    logger.info(`Loaded ${loaded}/${files.length} ${label} skills`);
    return loaded;
}

function loadPlugins() {
    if (!fs.existsSync(PLUGINS_DIR)) return 0;

    let loaded = 0;
    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'README.md') continue;

        if (entry.isFile() && entry.name.endsWith('.js')) {
            if (loadSkillFile(path.join(PLUGINS_DIR, entry.name), 'plugin')) {
                loaded++;
            }
        } else if (entry.isDirectory()) {
            const entryPoint = path.join(PLUGINS_DIR, entry.name, 'skill.js');
            if (fs.existsSync(entryPoint)) {
                if (loadSkillFile(entryPoint, 'plugin')) {
                    loaded++;
                }
            }
        }
    }

    if (loaded > 0) {
        logger.info(`Loaded ${loaded} plugin skills`);
    }
    return loaded;
}

// ── Boot: auto-run on require ──────────────────────────────

loadDirectory(CORE_DIR, 'core');
loadPlugins();

module.exports = {
    loadDirectory,
    loadPlugins,
    reload() {
        registry.clear();
        loadDirectory(CORE_DIR, 'core');
        loadPlugins();
    },
};
