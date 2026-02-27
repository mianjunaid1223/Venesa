/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill Validator
 *  Validates skill/plugin module structure before registration.
 *  Enforces the unified protocol standard.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: brain/protocol
 *  USED BY:    skills/loader
 * ═══════════════════════════════════════════════════════════════
 */

const {
    VALID_RETURN_TYPES,
    VALID_MARKERS,
    UI_COMPONENTS,
    LIFECYCLE_HOOKS,
} = require('../brain/protocol');

function validate(skill, filePath) {
    const errors = [];
    const warnings = [];

    if (!skill || typeof skill !== 'object') {
        return { valid: false, errors: ['Module does not export an object'], warnings: [] };
    }

    // ── Required fields ────────────────────────────────────

    if (!skill.name || typeof skill.name !== 'string') {
        errors.push('Missing or invalid "name" (must be a non-empty string)');
    }

    if (!skill.description || typeof skill.description !== 'string') {
        errors.push('Missing or invalid "description" (must be a non-empty string)');
    }

    if (typeof skill.handler !== 'function' && typeof skill.execute !== 'function') {
        errors.push('Missing or invalid "handler" or "execute" (must be a function)');
    }

    // ── returnType (required) ──────────────────────────────

    if (!skill.returnType) {
        errors.push('Missing "returnType". Must be one of: ' + VALID_RETURN_TYPES.join(', '));
    } else if (!VALID_RETURN_TYPES.includes(skill.returnType)) {
        errors.push(`Invalid "returnType": "${skill.returnType}". Must be one of: ${VALID_RETURN_TYPES.join(', ')}`);
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

module.exports = { validate };
