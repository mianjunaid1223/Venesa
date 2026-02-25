/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Skill Registry
 *  Map of skillName → skill object. Skills register via loader.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: lib/logger
 *  USED BY:    brain/orchestrator, brain/processor, skills/loader
 * ═══════════════════════════════════════════════════════════════
 */

const logger = require('../lib/logger');

const skills = new Map();

const { z } = require('zod');

function register(name, skillModule, source = 'core') {
    if (!name || typeof name !== 'string') {
        throw new Error('Skill name must be a non-empty string');
    }
    if (skills.has(name)) {
        logger.warn(`Skill '${name}' already registered — overwriting`);
    }

    // Validate schema if it exists, otherwise provide a default empty schema
    let schema = skillModule.schema;
    if (schema) {
        if (typeof schema.parse !== 'function') {
            throw new Error(`Skill '${name}' provided an invalid schema. Must have a parse() method.`);
        }
    } else {
        logger.warn(`Skill '${name}' registered without a schema. Defaulting to z.any().`);
        schema = z.any();
    }

    // Attach source so we can distinguish built-ins from plugins later
    const entry = Object.assign({}, skillModule, { _source: source, schema });
    skills.set(name, entry);
    logger.debug(`Registered ${source} skill: ${name}`);
}

function get(name) {
    return skills.get(name) || null;
}

function has(name) {
    return skills.has(name);
}

function unregister(name) {
    return skills.delete(name);
}

function getAll() {
    return Object.fromEntries(skills);
}

function getAllNames() {
    return [...skills.keys()];
}

function getSkillList() {
    const list = [];
    for (const [name, skill] of skills) {
        list.push({
            name,
            description: skill.description || '',
            tags: skill.tags || [],
            ui: skill.ui || null,
            source: skill._source || 'core',
            schema: skill.schema
        });
    }
    return list;
}

/** Returns only built-in core skills */
function getBuiltinSkills() {
    return getSkillList().filter(s => s.source === 'core');
}

/** Returns only external plugin skills */
function getAllPlugins() {
    return getSkillList().filter(s => s.source === 'plugin');
}

function clear() {
    skills.clear();
}

module.exports = {
    register,
    get,
    has,
    unregister,
    getAll,
    getAllNames,
    getSkillList,
    getBuiltinSkills,
    getAllPlugins,
    clear,
};
