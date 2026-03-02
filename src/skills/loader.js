/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Capability Loader
 *  Auto-discovers and registers capabilities from:
 *    - src/skills/core/       (built-in core capabilities)
 *    - src/skills/internal/   (internal system capabilities)
 *    - ~/.venesa/capabilities/ (community-installed capabilities)
 *
 *  All sources pass the same validator. Runtime does not distinguish
 *  capability origin — every registered entry is an equal module.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, skills/registry, skills/validator
 *  USED BY:    brain/processor (auto-loaded on first require)
 * ═══════════════════════════════════════════════════════════════
 *
 *  CAPABILITY STANDARD SCHEMA
 *  ──────────────────────────
 *  module.exports = {
 *    name:        string,                // unique camelCase identifier
 *    description: string,                // shown in Settings + injected into AI prompt
 *    version:     string,                // semver (e.g. "1.0.0") — recommended
 *    returnType:  'data'|'action'|'ui'|'memory'|'hybrid',  // REQUIRED
 *    marker:      'silently'|'announce'|'confirm',         // execution feedback level
 *    ui:          string|null,           // optional: 'table'|'key-value'|'card-list'|'command-list'
 *    schema:      ZodObject,             // Zod schema for parameter validation
 *    config:      ZodObject,             // optional: capability configuration schema
 *    lifecycle:   { onLoad, onUnload, onEnable, onDisable },  // optional hooks
 *    handler:     async (params, context) => any, // REQUIRED — must be async
 *  };
 *
 *  Community capabilities may also include:
 *    enabled:    boolean  // (optional) start disabled if false
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../lib/logger');
const registry = require('./registry');
const validator = require('./validator');

// ── Module resolution fix ─────────────────────────────────────
// Community capabilities are stored in ~/.venesa/capabilities/ which is
// outside the project tree. Node resolution walking up from there will
// never reach the app's node_modules, so require('zod') etc. fail.
// We patch Module._resolveFilename once to fall back to the app's own
// node_modules directory whenever normal resolution fails.
(function patchModuleResolution() {
    const Module = require('module');
    let APP_NODE_MODULES;
    try {
        // Dynamic: derive from a known bundled package (works packed or dev)
        APP_NODE_MODULES = path.dirname(path.dirname(require.resolve('zod/package.json')));
    } catch {
        APP_NODE_MODULES = path.resolve(__dirname, '..', '..', 'node_modules');
    }
    if (!Module._resolveFilename.__venesa_patched) {
        const _orig = Module._resolveFilename.bind(Module);
        Module._resolveFilename = function venesa_resolveFilename(request, parent, isMain, options) {
            try {
                return _orig(request, parent, isMain, options);
            } catch (e) {
                if (e.code === 'MODULE_NOT_FOUND') {
                    try {
                        return _orig(request, {
                            id: path.join(APP_NODE_MODULES, '_'),
                            filename: path.join(APP_NODE_MODULES, '_'),
                            paths: [APP_NODE_MODULES],
                        }, isMain, options);
                    } catch { /* ignore, rethrow original */ }
                }
                throw e;
            }
        };
        Module._resolveFilename.__venesa_patched = true;
    }
}());

const CORE_DIR = path.join(__dirname, 'core');
const INTERNAL_DIR = path.join(__dirname, 'internal');

// Community capabilities installed to the user's home directory
function getCapabilitiesDir() {
    // Prefer the paths module when electron is available
    try {
        const paths = require('../lib/paths');
        if (typeof paths.getCapabilitiesPath === 'function') {
            return paths.getCapabilitiesPath();
        }
    } catch { /* fall back to raw os.homedir */ }
    return path.join(os.homedir(), '.venesa', 'capabilities');
}

// ── Helpers ──────────────────────────────────────────────────

function getUserCapabilityState(capabilityName) {
    try {
        const memory = require('../brain/memory');
        // Migrate legacy pluginStates key on first read
        const states = memory.get('aliases', 'capabilityStates')
            || memory.get('aliases', 'pluginStates')
            || {};
        if (states[capabilityName] === true) return true;
        if (states[capabilityName] === false) return false;
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
            logger.warn(`Skipping invalid capability at ${filePath}: ${result.errors.join(', ')}`);
            return false;
        }

        // Wrap handler in try/catch isolation for all capabilities
        validator.wrapHandler(skill, filePath);

        // For community capabilities: check enabled state
        if (source === 'community') {
            const userState = getUserCapabilityState(skill.name);
            // Community capabilities installed via the installer start disabled by default.
            // The installer marks them with enabled:false until the user explicitly enables them.
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

/**
 * Load all community capabilities from ~/.venesa/capabilities/
 * Each file must be a single-file capability (one .js file = one capability).
 */
function loadCapabilities() {
    const capDir = getCapabilitiesDir();
    if (!fs.existsSync(capDir)) return 0;

    let loaded = 0;
    const entries = fs.readdirSync(capDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.js')) continue;
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

        if (loadSkillFile(path.join(capDir, entry.name), 'community')) {
            loaded++;
        }
    }

    if (loaded > 0) {
        logger.info(`Loaded ${loaded} community capabilities from ${capDir}`);
    }
    return loaded;
}

// ── Boot: auto-run on require ──────────────────────────────

loadDirectory(CORE_DIR, 'core', 'core');
loadDirectory(INTERNAL_DIR, 'internal', 'internal');
loadCapabilities();

module.exports = {
    loadDirectory,
    loadCapabilities,
    reload() {
        registry.clear();
        loadDirectory(CORE_DIR, 'core', 'core');
        loadDirectory(INTERNAL_DIR, 'internal', 'internal');
        loadCapabilities();
    },
    getCapabilitiesDir,
};
