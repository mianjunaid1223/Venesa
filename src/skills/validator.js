/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill Validator
 *  Validates skill module structure before registration.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: (none)
 *  USED BY:    skills/loader
 * ═══════════════════════════════════════════════════════════════
 */

const VALID_PERMISSIONS = ['safe', 'normal', 'dangerous'];
const VALID_MARKERS = ['silently', 'announce', 'confirm'];

function validate(skill, filePath) {
    const errors = [];

    if (!skill || typeof skill !== 'object') {
        return { valid: false, errors: ['Module does not export an object'] };
    }

    if (!skill.name || typeof skill.name !== 'string') {
        errors.push('Missing or invalid "name" (must be a non-empty string)');
    }

    if (!skill.description || typeof skill.description !== 'string') {
        errors.push('Missing or invalid "description" (must be a non-empty string)');
    }

    if (typeof skill.handler !== 'function' && typeof skill.execute !== 'function') {
        errors.push('Missing or invalid "handler" or "execute" (must be a function)');
    }

    if (skill.permission && !VALID_PERMISSIONS.includes(skill.permission)) {
        errors.push(`Invalid "permission": "${skill.permission}". Must be one of: ${VALID_PERMISSIONS.join(', ')}`);
    }

    if (skill.marker && !VALID_MARKERS.includes(skill.marker)) {
        errors.push(`Invalid "marker": "${skill.marker}". Must be one of: ${VALID_MARKERS.join(', ')}`);
    }

    if (skill.tags && !Array.isArray(skill.tags)) {
        errors.push('"tags" must be an array');
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

module.exports = { validate };
