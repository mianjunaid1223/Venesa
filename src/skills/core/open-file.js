/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: open-file
 *  Open a file from the user home directory.
 * ═══════════════════════════════════════════════════════════════
 */

const { shell } = require('electron');
const path = require('path');
const { HOME_DIR } = require('./_shared');

module.exports = {
    name: 'openFile',
    description: 'Open a file from the user home directory',
    tags: ['file', 'open'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const filePath = params.filePath;
        if (!filePath || typeof filePath !== 'string') {
            return 'No file path provided.';
        }

        try {
            const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(path.join(HOME_DIR, filePath));
            const normalizedPath = path.normalize(resolvedPath);
            const normalizedHome = path.normalize(HOME_DIR);
            const homePrefix = path.normalize(HOME_DIR + path.sep);

            const isMatch = normalizedPath.toLowerCase() === normalizedHome.toLowerCase() ||
                normalizedPath.toLowerCase().startsWith(homePrefix.toLowerCase());

            if (!isMatch) {
                return 'Access denied: path outside home directory.';
            }

            const result = await shell.openPath(resolvedPath);
            if (result) {
                return `Error opening file: ${result}`;
            }
            return `Opened ${filePath}`;
        } catch (e) {
            return `Error: ${e.message}`;
        }
    },
};
