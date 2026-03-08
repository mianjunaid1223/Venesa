const logger = require('./logger');

const ALLOWED_PREFIXES = [];

function getEnv(key) {
    if (!key || typeof key !== 'string') {
        logger.warn('[env] getEnv called with invalid key');
        return undefined;
    }
    const value = process.env[key];
    logger.debug(`[env] getEnv("${key}") -> ${value !== undefined ? '[set]' : '[unset]'}`);
    return value;
}

module.exports = { getEnv };
