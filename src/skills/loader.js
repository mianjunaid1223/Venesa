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
// Resolution order per capability:
//   1. Capability-local node_modules  (~/.venesa/capabilities/<name>/node_modules/)
//   2. App node_modules               (project root node_modules)
//   3. Platform src modules           (remaps relative paths to app internals,
//                                      e.g. require('../src/lib/powershell') →
//                                           <appRoot>/src/lib/powershell.js)
// Patch is guarded by __venesa_cap_patched so it only runs once.
(function patchModuleResolution() {
    const Module = require('module');
    if (Module._resolveFilename.__venesa_cap_patched) return;

    let APP_NODE_MODULES;
    try {
        APP_NODE_MODULES = path.dirname(path.dirname(require.resolve('zod/package.json')));
    } catch {
        APP_NODE_MODULES = path.resolve(__dirname, '..', '..', 'node_modules');
    }

    function getCapLocalNodeModules(parent) {
        try {
            if (!parent || !parent.filename) return null;
            const capDir = getCapabilitiesDir();
            const parentFile = parent.filename;
            const parentDir = path.dirname(parentFile);

            // The capability file itself lives directly in capabilitiesDir
            if (path.normalize(parentDir) === path.normalize(capDir)) {
                const capName = path.basename(parentFile, '.js');
                return path.join(capDir, capName, 'node_modules');
            }
            // A transitive require from inside that capability's own node_modules
            const capDirNorm = path.normalize(capDir) + path.sep;
            if (path.normalize(parentFile).startsWith(capDirNorm)) {
                const relParts = path.relative(capDir, parentFile).split(path.sep);
                if (relParts.length > 1) {
                    return path.join(capDir, relParts[0], 'node_modules');
                }
            }
        } catch { /* ignore */ }
        return null;
    }

    const APP_SRC = path.resolve(__dirname, '..');  // src/

    const _orig = Module._resolveFilename.bind(Module);
    Module._resolveFilename = function venesa_resolveFilename(request, parent, isMain, options) {
        try {
            return _orig(request, parent, isMain, options);
        } catch (e) {
            if (e.code === 'MODULE_NOT_FOUND') {
                // 1. Capability-local node_modules
                const capLocal = getCapLocalNodeModules(parent);
                if (capLocal) {
                    try {
                        return _orig(request, {
                            id: path.join(capLocal, '_'),
                            filename: path.join(capLocal, '_'),
                            paths: [capLocal],
                        }, isMain, options);
                    } catch { /* fall through */ }
                }
                // 2. App node_modules
                try {
                    return _orig(request, {
                        id: path.join(APP_NODE_MODULES, '_'),
                        filename: path.join(APP_NODE_MODULES, '_'),
                        paths: [APP_NODE_MODULES],
                    }, isMain, options);
                } catch { /* fall through */ }
                // 3. Platform source modules — handles community capabilities that
                //    use relative paths to platform internals, e.g.:
                //      require('../src/lib/powershell')
                //      require('../../lib/logger')
                //    Detect the nearest known src segment and remap to actual APP_SRC.
                try {
                    let candidate = request;
                    if (request.startsWith('.') && parent && parent.filename) {
                        candidate = path.resolve(path.dirname(parent.filename), request);
                    }
                    // Match the first occurrence of /lib/, /brain/, /skills/, /platform/
                    const re = new RegExp(`(?:^|[/\\\\])(lib|brain|skills|platform)[/\\\\](.+)$`, 'i');
                    const m = candidate.replace(/\\/g, '/').match(re);
                    if (m) {
                        const tail = m[1] + path.sep + m[2].replace(/\//g, path.sep);
                        return _orig(path.join(APP_SRC, tail), parent, isMain, options);
                    }
                } catch { /* rethrow original */ }
            }
            throw e;
        }
    };
    Module._resolveFilename.__venesa_cap_patched = true;
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

async function loadSkillFile(filePath, source = 'core') {
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
            const existing = registry.get(skill.name);
            // Community capabilities are allowed to override core skills (user explicitly installed them).
            if (source === 'community' && existing && existing._source === 'core') {
                logger.info(`[loader] Community capability '${skill.name}' overriding core skill from ${filePath}`);
                if (typeof existing.lifecycle?.onUnload === 'function') {
                    try {
                        await Promise.resolve(existing.lifecycle.onUnload());
                    } catch (e) {
                        logger.warn(`[loader] onUnload hook failed for core skill '${existing.name}' during override: ${e?.message ?? String(e)}`);
                    }
                }
                registry.unregister(skill.name);
            } else {
                logger.warn(`Duplicate skill name '${skill.name}' in ${filePath} — skipping`);
                return false;
            }
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

async function loadDirectory(dir, label, source = 'core') {
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
        if (await loadSkillFile(filePath, source)) {
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
async function loadCapabilities() {
    const capDir = getCapabilitiesDir();
    if (!fs.existsSync(capDir)) return 0;

    let loaded = 0;
    const entries = fs.readdirSync(capDir, { withFileTypes: true });

    for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!entry.name.endsWith('.js')) continue;
        if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

        if (await loadSkillFile(path.join(capDir, entry.name), 'community')) {
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
    async reload() {
        registry.clear();
        await loadDirectory(CORE_DIR, 'core', 'core');
        await loadDirectory(INTERNAL_DIR, 'internal', 'internal');
        await loadCapabilities();
    },
    getCapabilitiesDir,
};
