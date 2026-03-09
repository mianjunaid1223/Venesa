// Shared helpers for core skills (PowerShell runner, path utilities).
const os = require('os');
const path = require('path');
const logger = require('../../lib/logger');
const powershell = require('../../lib/powershell');

const HOME_DIR = os.homedir();

async function runPowerShell(script, args = [], timeout = 30000) {
    if (typeof args === 'number') {
        timeout = args;
        args = [];
    }
    return powershell.execute(script, args, timeout);
}

function getRelativePath(fullPath) {
    const relative = path.relative(HOME_DIR, fullPath);
    return (relative || fullPath).replace(/\\/g, '/');
}

function escapeForPowerShell(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/'/g, "''").replace(/`/g, '``').replace(/\$/g, '`$');
}

module.exports = {
    HOME_DIR,
    runPowerShell,
    getRelativePath,
    escapeForPowerShell,
    logger,
};
