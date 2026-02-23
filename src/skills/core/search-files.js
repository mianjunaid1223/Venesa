/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: search-files
 *  Search for files, folders, and apps on the system.
 * ═══════════════════════════════════════════════════════════════
 */

const path = require('path');
const fs = require('fs');
const { HOME_DIR, getRelativePath, logger } = require('./_shared');

async function searchFilesAndFolders(query, maxResults = 20) {
    const folders = [];
    const files = [];
    const lowerQuery = query.toLowerCase();
    const searchDirs = [
        path.join(HOME_DIR, 'Desktop'),
        path.join(HOME_DIR, 'Documents'),
        path.join(HOME_DIR, 'Downloads'),
        path.join(HOME_DIR, 'Pictures'),
        path.join(HOME_DIR, 'Music'),
        path.join(HOME_DIR, 'Videos'),
        path.join(HOME_DIR, 'OneDrive', 'Desktop'),
        path.join(HOME_DIR, 'OneDrive', 'Documents'),
    ];

    let foundCount = 0;

    const searchDir = async (dir, depth) => {
        if (foundCount >= maxResults || depth > 2) return;
        try {
            if (!fs.existsSync(dir)) return;
            const contents = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const dirent of contents) {
                if (foundCount >= maxResults) break;
                const fullPath = path.join(dir, dirent.name);
                if (dirent.name.startsWith('.') || dirent.name.startsWith('$')) continue;
                if (dirent.name.toLowerCase().includes(lowerQuery)) {
                    if (dirent.isDirectory()) {
                        folders.push(getRelativePath(fullPath));
                    } else {
                        files.push(getRelativePath(fullPath));
                    }
                    foundCount++;
                }
                if (dirent.isDirectory()) {
                    await searchDir(fullPath, depth + 1);
                }
            }
        } catch (e) {
            logger.debug(`Search dir error: ${e.message}`);
        }
    };

    for (const dir of searchDirs) {
        await searchDir(dir, 0);
    }

    return { files, folders };
}

module.exports = {
    name: 'searchFiles',
    description: 'Search for files, folders, and apps on the system',
    tags: ['search', 'file', 'find'],
    permission: 'safe',
    marker: 'announce',
    ui: 'card-list',

    async handler(params) {
        const query = params?.query?.trim();
        if (!query || typeof query !== 'string') {
            return JSON.stringify({ notFound: true });
        }

        const { files, folders } = await searchFilesAndFolders(query.trim());
        if (!files.length && !folders.length) {
            return JSON.stringify({ notFound: true });
        }
        return JSON.stringify({ files, folders });
    },
};
