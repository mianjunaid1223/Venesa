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
 *    name:        string,                // unique camelCase identifier
 *    description: string,                // shown in Settings + injected into AI prompt
 *    returnType:  'data'|'action'|'ui'|'memory'|'hybrid',  // REQUIRED
 *    marker:      'silently'|'announce'|'confirm',         // execution feedback level
 *    ui:          string|null,           // optional: 'table'|'key-value'|'card-list'|'command-list'
 *    schema:      ZodObject,             // Zod schema for parameter validation
 *    config:      ZodObject,             // optional: plugin configuration schema
 *    lifecycle:   { onLoad, onUnload, onEnable, onDisable },  // optional hooks
 *    handler:     async (params) => any, // REQUIRED
 *  };
 *
 *  Plugins live in /plugins/ and may also include:
 *    enabled:    boolean  // (optional) start disabled if false
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const registry = require('./registry');
const validator = require('./validator');

const CORE_DIR = path.join(__dirname, 'core');
const INTERNAL_DIR = path.join(__dirname, 'internal');
const PLUGINS_DIR = path.join(__dirname, '../../plugins');

// ── Helpers ──────────────────────────────────────────────────

function getUserPluginState(pluginName) {
    try {
        const memory = require('../brain/memory');
        const states = memory.get('aliases', 'pluginStates') || {};
        if (states[pluginName] === true) return true;
        if (states[pluginName] === false) return false;
        return null;
    } catch {
        return null;
    }
}

function loadSkillFile(filePath, source = 'core') {
    try {
        if (require.cache[require.resolve(filePath)]) {
            delete require.cache[require.resolve(filePath)];
        }
        const skill = require(filePath);

        // Validate against unified protocol standard
        const result = validator.validate(skill, filePath);

        if (result.warnings && result.warnings.length > 0) {
            result.warnings.forEach(w => logger.warn(`[loader] ${filePath}: ${w}`));
        }

        if (!result.valid) {
            logger.warn(`Skipping invalid skill at ${filePath}: ${result.errors.join(', ')}`);
            return false;
        }

        // For plugins: check enabled state
        if (source === 'plugin') {
            const userState = getUserPluginState(skill.name);
            if (skill.enabled === false) {
                skill._enabled = (userState === true);
            } else {
                skill._enabled = (userState !== false);
            }
        }

        if (registry.has(skill.name)) {
            logger.warn(`Duplicate skill name '${skill.name}' in ${filePath} — skipping`);
            return false;
        }

        registry.register(skill.name, skill, source);

        // Call lifecycle onLoad hook (supports async)
        if (skill.lifecycle?.onLoad) {
            try {
                const hookResult = skill.lifecycle.onLoad();
                if (hookResult && typeof hookResult.then === 'function') {
                    hookResult.catch(e => logger.warn(`Lifecycle onLoad (async) failed for '${skill.name}': ${e?.message ?? String(e)}`));
                }
            } catch (e) {
                logger.warn(`Lifecycle onLoad failed for '${skill.name}': ${e?.message ?? String(e)}`);
            }
        }

        return true;
    } catch (e) {
        logger.error(`Failed to load skill at ${filePath}: ${e.message}`);
        return false;
    }
}

function loadDirectory(dir, label, source = 'core') {
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
        if (loadSkillFile(filePath, source)) {
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

loadDirectory(CORE_DIR, 'core', 'core');
loadDirectory(INTERNAL_DIR, 'internal', 'internal');
loadPlugins();

module.exports = {
    loadDirectory,
    loadPlugins,
    reload() {
        // registry.clear() calls onUnload for all skills internally
        registry.clear();
        loadDirectory(CORE_DIR, 'core', 'core');
        loadDirectory(INTERNAL_DIR, 'internal', 'internal');
        loadPlugins();
    },
};
