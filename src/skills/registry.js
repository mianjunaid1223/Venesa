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

function register(name, skillModule) {
    if (!name || typeof name !== 'string') {
        throw new Error('Skill name must be a non-empty string');
    }
    if (skills.has(name)) {
        logger.warn(`Skill '${name}' already registered — overwriting`);
    }
    skills.set(name, skillModule);
    logger.debug(`Registered skill: ${name}`);
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
            permission: skill.permission || 'normal',
            ui: skill.ui || null,
        });
    }
    return list;
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
    clear,
};
