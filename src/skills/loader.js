/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill Loader
 *  Auto-discovers and registers skills from core/ and plugins/.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, skills/registry, skills/validator
 *  USED BY:    brain/processor (auto-loaded on first require)
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const logger = require('../lib/logger');
const registry = require('./registry');
const validator = require('./validator');

const CORE_DIR = path.join(__dirname, 'core');
const PLUGINS_DIR = path.join(__dirname, '../../plugins');

function loadSkillFile(filePath) {
    try {
        if (require.cache[require.resolve(filePath)]) {
            delete require.cache[require.resolve(filePath)];
        }
        const skill = require(filePath);
        const result = validator.validate(skill, filePath);

        if (!result.valid) {
            logger.warn(`Skipping invalid skill at ${filePath}: ${result.errors.join(', ')}`);
            return false;
        }

        if (registry.has(skill.name)) {
            logger.warn(`Duplicate skill name '${skill.name}' in ${filePath} — skipping`);
            return false;
        }

        registry.register(skill.name, skill);
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
        if (loadSkillFile(filePath)) {
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
            if (loadSkillFile(path.join(PLUGINS_DIR, entry.name))) {
                loaded++;
            }
        } else if (entry.isDirectory()) {
            const entryPoint = path.join(PLUGINS_DIR, entry.name, 'skill.js');
            if (fs.existsSync(entryPoint)) {
                if (loadSkillFile(entryPoint)) {
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
