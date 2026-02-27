/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: open-file
 *  Open a file from the user home directory.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { HOME_DIR } = require('./_shared');

module.exports = {
    schema: z.object({ filePath: z.string().describe('The path of the file to open') }),
    name: 'openFile',
    description: 'Open a file from the user home directory',
    tags: ['file', 'open'],

    returnType: 'action',
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

            let isMatch = false;
            try {
                const realPath = fs.realpathSync(normalizedPath);
                const realHome = fs.realpathSync(HOME_DIR);
                isMatch = realPath.toLowerCase() === realHome.toLowerCase() ||
                    realPath.toLowerCase().startsWith(realHome.toLowerCase() + path.sep);
            } catch (e) {
                const normalizedHome = path.normalize(HOME_DIR);
                const homePrefix = path.normalize(HOME_DIR + path.sep);
                isMatch = normalizedPath.toLowerCase() === normalizedHome.toLowerCase() ||
                    normalizedPath.toLowerCase().startsWith(homePrefix.toLowerCase());
            }

            if (!isMatch) {
                return 'Access denied: path outside home directory.';
            }

            const result = await shell.openPath(normalizedPath);
            if (result) {
                return `Error opening file: ${result}`;
            }
            return `Opened ${filePath}`;
        } catch (e) {
            return `Error: ${e instanceof Error ? e.message : String(e)}`;
        }
    },
};
