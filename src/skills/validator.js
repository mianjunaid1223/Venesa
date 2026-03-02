/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill / Capability Validator
 *  Validates skill/capability module structure before registration.
 *  Enforces the unified protocol standard.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/protocol
 *  USED BY:    skills/loader, platform/capability-installer
 * ═══════════════════════════════════════════════════════════════
 */

const {
    VALID_RETURN_TYPES,
    VALID_MARKERS,
    UI_COMPONENTS,
    LIFECYCLE_HOOKS,
} = require('../brain/protocol');

const logger = require('../lib/logger');

// Patterns that indicate side-effect execution at module load time.
// These are only checked when validating raw source strings.
const IMMEDIATE_EXECUTION_PATTERNS = [
    /^\s*\(/m,                      // IIFE
    /setInterval\s*\(/,
    /setTimeout\s*\(/,
    /process\.exit\s*\(/,
];

/**
 * Validate a raw JS source string for immediate-execution patterns.
 * Returns an array of violation messages (empty = clean).
 */
function checkSourceForSideEffects(source) {
    const issues = [];
    for (const re of IMMEDIATE_EXECUTION_PATTERNS) {
        if (re.test(source)) {
            issues.push(`Source contains potentially unsafe immediate-execution pattern: ${re.toString()}`);
        }
    }
    return issues;
}

/**
 * Detect if a function was declared with the `async` keyword by checking
 * fn.constructor.name === 'AsyncFunction'. NOTE: this does NOT detect
 * regular functions or arrow functions that return a Promise — only
 * syntactically async-declared functions are identified here.
 */
function isAsyncFunction(fn) {
    return fn.constructor && fn.constructor.name === 'AsyncFunction';
}

function validate(skill, filePath) {
    const errors = [];
    const warnings = [];
    const loc = filePath ? `[${filePath}] ` : '';

    if (!skill || typeof skill !== 'object') {
        return { valid: false, errors: [`${loc}Module does not export an object`], warnings: [] };
    }

    // ── Required fields ────────────────────────────────────

    if (!skill.name || typeof skill.name !== 'string') {
        errors.push('Missing or invalid "name" (must be a non-empty string)');
    }

    if (!skill.description || typeof skill.description !== 'string') {
        errors.push('Missing or invalid "description" (must be a non-empty string)');
    }

    if (typeof skill.handler !== 'function') {
        errors.push('Missing or invalid "handler" (must be a function)');
    } else if (!isAsyncFunction(skill.handler)) {
        warnings.push('"handler" should be an async function or return a Promise; non-async handlers may cause unexpected behaviour');
    }

    // ── returnType (required) ──────────────────────────────

    if (!skill.returnType) {
        errors.push('Missing "returnType". Must be one of: ' + VALID_RETURN_TYPES.join(', '));
    } else if (!VALID_RETURN_TYPES.includes(skill.returnType)) {
        errors.push(`Invalid "returnType": "${skill.returnType}". Must be one of: ${VALID_RETURN_TYPES.join(', ')}`);
    }

    // ── version (recommended for community capabilities) ───

    if (skill.version !== undefined && typeof skill.version !== 'string') {
        errors.push('"version" must be a string (e.g. "1.0.0")');
    }

    // ── schema (required for community capabilities) ───────

    if (skill.schema !== undefined && typeof skill.schema.parse !== 'function') {
        errors.push('"schema" must be a valid Zod schema (must have a parse() method)');
    }

    // ── Optional validated fields ──────────────────────────

    if (skill.marker && !VALID_MARKERS.includes(skill.marker)) {
        errors.push(`Invalid "marker": "${skill.marker}". Must be one of: ${VALID_MARKERS.join(', ')}`);
    }

    if (skill.ui && !UI_COMPONENTS.includes(skill.ui)) {
        errors.push(`Invalid "ui": "${skill.ui}". Must be one of: ${UI_COMPONENTS.join(', ')}`);
    }

    if (skill.tags && !Array.isArray(skill.tags)) {
        errors.push('"tags" must be an array');
    }

    // ── Lifecycle hooks ────────────────────────────────────

    if (skill.lifecycle) {
        if (typeof skill.lifecycle !== 'object') {
            errors.push('"lifecycle" must be an object');
        } else {
            for (const key of Object.keys(skill.lifecycle)) {
                if (!LIFECYCLE_HOOKS.includes(key)) {
                    warnings.push(`Unknown lifecycle hook "${key}". Valid hooks: ${LIFECYCLE_HOOKS.join(', ')}`);
                } else if (typeof skill.lifecycle[key] !== 'function') {
                    errors.push(`Lifecycle hook "${key}" must be a function`);
                }
            }
        }
    }

    // ── Config schema ──────────────────────────────────────

    if (skill.config && typeof skill.config.parse !== 'function') {
        errors.push('"config" must be a Zod schema (must have a parse() method)');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
    };
}

/**
 * Wrap a capability's handler in try/catch isolation so a failing
 * capability can never crash the Venesa runtime.
 */
function wrapHandler(skill, filePath) {
    const original = skill.handler;
    const label = skill.name || filePath || 'unknown';
    skill.handler = async function isolatedHandler(params, context) {
        try {
            return await original.call(skill, params, context);
        } catch (e) {
            logger.error(`[capability:${label}] handler threw: ${e?.message ?? String(e)}`);
            throw e; // re-throw so orchestrator can report it to the user
        }
    };
    return skill;
}

module.exports = { validate, checkSourceForSideEffects, wrapHandler };
