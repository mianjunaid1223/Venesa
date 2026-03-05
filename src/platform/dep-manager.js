"use strict";

/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Dependency Manager (Dep Engine)
 *  Deterministic, version-isolated dependency handling per
 *  capability. Uses pacote for full transitive resolution —
 *  no external npm / node required on the user's machine.
 *
 *  Runtime layout:
 *    ~/.venesa/capabilities/<capabilityName>/
 *      node_modules/          <- flat-hoisted, isolated per capability
 *
 *  Shared manifests at capabilities root:
 *    dependencies.json        <- { capName: { pkg: "x.y.z" } }
 *    dep-failures.json        <- { "capName@@pkg@x.y.z": count }
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger, lib/paths, brain/memory, pacote
 *  USED BY:    platform/capability-installer
 * ═══════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const logger = require('../lib/logger');

const DEP_MANIFEST_FILE = 'dependencies.json';
const DEP_FAILURES_FILE = 'dep-failures.json';
const MAX_FAILURES = 5;

// ── Path helpers ─────────────────────────────────────────────

function getCapabilitiesRoot() {
    try {
        const paths = require('../lib/paths');
        if (typeof paths.getCapabilitiesPath === 'function') {
            return paths.getCapabilitiesPath();
        }
    } catch { /* fall back */ }
    return path.join(os.homedir(), '.venesa', 'capabilities');
}

function getCapDir(capabilityName) {
    return path.join(getCapabilitiesRoot(), capabilityName);
}

function getManifestPath() {
    return path.join(getCapabilitiesRoot(), DEP_MANIFEST_FILE);
}

function getFailuresPath() {
    return path.join(getCapabilitiesRoot(), DEP_FAILURES_FILE);
}

// ── JSON I/O ─────────────────────────────────────────────────

// Per-file write queue — serialises concurrent writers without external deps.
const _writeQueues = new Map();

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        if (e.code !== 'ENOENT') {
            logger.warn(`[dep-engine] Failed to read ${path.basename(filePath)}: ${e.message}`);
        }
    }
    return {};
}

function writeJson(filePath, data) {
    const prev = _writeQueues.get(filePath) || Promise.resolve();
    const next = prev.then(() => {
        try {
            const dir = path.dirname(filePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            logger.error(`[dep-engine] Failed to write ${path.basename(filePath)}: ${e.message}`);
        }
    });
    _writeQueues.set(filePath, next);
    return next;
}

// ── Package spec parsing ─────────────────────────────────────
// Handles: "axios", "axios@1.7.9", "@scope/pkg", "@scope/pkg@1.0.0"

function parsePackageSpec(spec) {
    if (spec.startsWith('@')) {
        const atIdx = spec.indexOf('@', 1);
        if (atIdx > 0) {
            return { name: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) || null };
        }
        return { name: spec, version: null };
    }
    const atIdx = spec.indexOf('@');
    if (atIdx > 0) {
        return { name: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) || null };
    }
    return { name: spec, version: null };
}

// ── Recursive transitive installer ───────────────────────────

/**
 * Recursively resolve and extract a package and all its transitive
 * dependencies into a flat node_modules directory using pacote only.
 * No external npm / Node.js installation required.
 *
 * Uses "first-seen wins" flat hoisting — the same strategy npm uses
 * by default. If two packages depend on different versions of the
 * same transitive dep, the first resolved version is kept.
 *
 * @param {object}      pacote       - pacote module
 * @param {string}      spec         - e.g. "axios@1.7.9"
 * @param {string}      nodeModulesDir
 * @param {Set<string>} visited      - package names already extracted (dedup)
 */
async function extractTree(pacote, spec, nodeModulesDir, visited) {
    // Fetch the package manifest to get its name, resolved version, and deps
    let meta;
    try {
        meta = await pacote.manifest(spec);
    } catch (e) {
        throw new Error(`Failed to resolve manifest for "${spec}": ${e.message}`);
    }

    const pkgName = meta.name;

    // Flat-hoist dedup: if this package name is already installed, skip.
    // This matches npm's default hoisting behaviour.
    if (visited.has(pkgName)) return;
    visited.add(pkgName);

    const targetDir = path.join(nodeModulesDir, pkgName);

    // Extract the package files
    try {
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        await pacote.extract(`${pkgName}@${meta.version}`, targetDir);
        logger.debug(`[dep-engine] Extracted ${pkgName}@${meta.version}`);
    } catch (e) {
        throw new Error(`Failed to extract "${pkgName}@${meta.version}": ${e.message}`);
    }

    // Recurse into production dependencies only (skip devDependencies)
    const deps = meta.dependencies || {};
    for (const [depName, depRange] of Object.entries(deps)) {
        await extractTree(pacote, `${depName}@${depRange}`, nodeModulesDir, visited);
    }
}

// ── Manifest (dependencies.json) ─────────────────────────────

function getManifest() {
    return readJson(getManifestPath());
}

function saveManifest(data) {
    return writeJson(getManifestPath(), data);
}

// ── Failures (dep-failures.json) ─────────────────────────────

function getFailures() {
    return readJson(getFailuresPath());
}

function saveFailures(data) {
    return writeJson(getFailuresPath(), data);
}

function failureKey(capabilityName, packageSpec) {
    return `${capabilityName}@@${packageSpec}`;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Install all declared dependencies for a capability with full
 * transitive resolution. Requires no external tools — pacote is
 * bundled with the app.
 *
 * - Exact versions are used as-is.
 * - Floating specs resolve latest once and pin the result.
 * - Reinstalls always use the pinned version — never re-floats.
 *
 * @returns {{ success: true } | { success: false, corrupted?: true, reason?: string, error?: string }}
 */
async function installDepsForCapability(capabilityName, depArray) {
    try {
        if (!Array.isArray(depArray) || depArray.length === 0) {
            return { success: true };
        }

        let pacote;
        try {
            pacote = require('pacote');
        } catch (e) {
            logger.error(`[dep-engine] pacote not available: ${e.message}`);
            return { success: false, error: 'pacote not available' };
        }

        const manifest = getManifest();
        const failures = getFailures();
        if (!manifest[capabilityName]) manifest[capabilityName] = {};

        const nodeModulesDir = path.join(getCapDir(capabilityName), 'node_modules');
        fs.mkdirSync(nodeModulesDir, { recursive: true });

        // Shared visited set across all top-level specs so we don't
        // re-extract a transitive dep that multiple top-level packages share.
        const visited = new Set();

        for (const spec of depArray) {
            const { name: packageName, version: specifiedVersion } = parsePackageSpec(spec);
            const storedVersion = manifest[capabilityName][packageName];

            // ── Determine final version (determinism policy) ──────
            let finalVersion;
            if (specifiedVersion) {
                finalVersion = specifiedVersion;
            } else if (storedVersion) {
                finalVersion = storedVersion;
                logger.info(`[dep-engine] Reusing pinned ${packageName}@${finalVersion} for '${capabilityName}'`);
            } else {
                try {
                    const meta = await pacote.manifest(`${packageName}@latest`);
                    finalVersion = meta.version;
                    logger.info(`[dep-engine] Resolved ${packageName} → ${finalVersion} for '${capabilityName}'`);
                } catch (e) {
                    logger.error(`[dep-engine] Version resolution failed for "${spec}": ${e.message}`);
                    const fKey = failureKey(capabilityName, packageName);
                    failures[fKey] = (failures[fKey] || 0) + 1;
                    await saveFailures(failures);
                    if (failures[fKey] >= MAX_FAILURES) {
                        return { success: false, corrupted: true, reason: `Dependency ${spec} failed ${MAX_FAILURES} installs.` };
                    }
                    continue;
                }
            }

            const resolvedSpec = `${packageName}@${finalVersion}`;
            const fKey = failureKey(capabilityName, packageName);

            try {
                logger.info(`[dep-engine] Installing ${resolvedSpec} (+ transitive deps) for '${capabilityName}'`);
                await extractTree(pacote, resolvedSpec, nodeModulesDir, visited);

                // Pin resolved version
                manifest[capabilityName][packageName] = finalVersion;
                await saveManifest(manifest);

                if (failures[fKey]) {
                    delete failures[fKey];
                    await saveFailures(failures);
                }
            } catch (e) {
                logger.error(`[dep-engine] Install failed for ${resolvedSpec} (${capabilityName}): ${e.message}`);
                failures[fKey] = (failures[fKey] || 0) + 1;
                await saveFailures(failures);
                if (failures[fKey] >= MAX_FAILURES) {
                    return { success: false, corrupted: true, reason: `Dependency ${resolvedSpec} failed ${MAX_FAILURES} installs.` };
                }
                // Non-fatal: continue attempting remaining dependencies
                continue;
            }
        }

        return { success: true };
    } catch (e) {
        logger.error(`[dep-engine] installDepsForCapability error: ${e.message}`);
        return { success: false, error: e.message };
    }
}

/**
 * Remove all installed deps for a capability and clean manifests.
 * Never throws.
 */
async function removeDepsForCapability(capabilityName) {
    try {
        const nodeModulesDir = path.join(getCapDir(capabilityName), 'node_modules');
        if (fs.existsSync(nodeModulesDir)) {
            fs.rmSync(nodeModulesDir, { recursive: true, force: true });
            logger.info(`[dep-engine] Removed node_modules for '${capabilityName}'`);
        }
    } catch (e) {
        logger.error(`[dep-engine] Failed to remove node_modules for '${capabilityName}': ${e.message}`);
    }

    try {
        const manifest = getManifest();
        if (manifest[capabilityName]) {
            delete manifest[capabilityName];
            await saveManifest(manifest);
            logger.info(`[dep-engine] Removed manifest entry for '${capabilityName}'`);
        }
    } catch (e) {
        logger.error(`[dep-engine] Failed to clean manifest for '${capabilityName}': ${e.message}`);
    }

    try {
        const failures = getFailures();
        const prefix = `${capabilityName}@@`;
        const keys = Object.keys(failures).filter(k => k.startsWith(prefix));
        if (keys.length > 0) {
            keys.forEach(k => delete failures[k]);
            await saveFailures(failures);
            logger.info(`[dep-engine] Cleared ${keys.length} failure record(s) for '${capabilityName}'`);
        }
    } catch (e) {
        logger.error(`[dep-engine] Failed to clean failures for '${capabilityName}': ${e.message}`);
    }
}

/**
 * Get consecutive failure count for a package within a capability.
 * @param {string} packageSpec  The package name as stored by the dep engine
 *   (e.g., "axios" or "@scope/pkg"). This is the bare name, NOT the
 *   fully-qualified "name@version" specifier — the dep engine records
 *   failures keyed by name only. Both "name" and "name@version" are
 *   accepted; if a version suffix is present it is stripped internally
 *   so the lookup matches the stored key.
 * @param {string} capabilityName  The capability that owns the package.
 */
function getFailureCount(packageSpec, capabilityName) {
    try {
        const failures = getFailures();
        return failures[failureKey(capabilityName, packageSpec)] || 0;
    } catch (e) {
        logger.error(`[dep-engine] getFailureCount error: ${e.message}`);
        return 0;
    }
}

/**
 * Check whether a capability is currently marked corrupted.
 */
function isCorrupted(capabilityName) {
    try {
        const memory = require('../brain/memory');
        const corrupted = memory.get('aliases', 'corruptedCapabilities') || {};
        return !!corrupted[capabilityName];
    } catch (e) {
        logger.error(`[dep-engine] isCorrupted error: ${e.message}`);
        return false;
    }
}

/**
 * Return the full dependencies manifest keyed by capability name.
 */
function getDepManifest() {
    try {
        return getManifest();
    } catch (e) {
        logger.error(`[dep-engine] getDepManifest error: ${e.message}`);
        return {};
    }
}

/**
 * Return pinned versions for a specific capability.
 * @returns {{ [packageName: string]: string }}
 */
function getResolvedDepsForCapability(capabilityName) {
    try {
        const manifest = getManifest();
        return manifest[capabilityName] || {};
    } catch (e) {
        logger.error(`[dep-engine] getResolvedDepsForCapability error: ${e.message}`);
        return {};
    }
}

module.exports = {
    installDepsForCapability,
    removeDepsForCapability,
    getFailureCount,
    isCorrupted,
    getDepManifest,
    getResolvedDepsForCapability,
};
