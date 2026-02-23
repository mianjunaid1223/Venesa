/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL SHARED: _shared
 *  Shared helpers used by core skills (PowerShell, paths, etc.)
 * ═══════════════════════════════════════════════════════════════
 */

const os = require('os');
const path = require('path');
const logger = require('../../lib/logger');
const powershell = require('../../lib/powershell');

const HOME_DIR = os.homedir();

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff'];
const CODE_EXTENSIONS = ['.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.cs', '.rb', '.go', '.rs', '.php', '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.md', '.txt', '.sh', '.bat', '.ps1'];

async function runPowerShell(script, args = [], timeout = 30000) {
    if (typeof args === 'number') {
        timeout = args;
        args = [];
    }
    return powershell.execute(script, args, timeout);
}

function getRelativePath(fullPath) {
    const relative = path.relative(HOME_DIR, fullPath);
    return relative || fullPath;
}

function escapeForPowerShell(str) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/'/g, "''").replace(/`/g, '``').replace(/\$/g, '`$');
}

module.exports = {
    HOME_DIR,
    IMAGE_EXTENSIONS,
    CODE_EXTENSIONS,
    runPowerShell,
    getRelativePath,
    escapeForPowerShell,
    logger,
};
