/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: search-files
 *  Search for files, folders, and apps on the system.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const path = require('path');
const fs = require('fs');
const { HOME_DIR, getRelativePath, logger } = require('./_shared');

async function searchFilesAndFolders(query, maxResults = 20) {
    const results = [];
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);
    if (keywords.length === 0) return { files: [], folders: [] };

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

    const searchDir = async (dir, depth) => {
        if (depth > 3) return;
        try {
            if (!fs.existsSync(dir)) return;
            const contents = await fs.promises.readdir(dir, { withFileTypes: true });
            for (const dirent of contents) {
                const fullPath = path.join(dir, dirent.name);
                if (dirent.name.startsWith('.') || dirent.name.startsWith('$')) continue;
                const lowerName = dirent.name.toLowerCase();
                const isDir = dirent.isDirectory();
                const score = keywords.filter(k => lowerName.includes(k)).length;
                if (score > 0) {
                    results.push({ name: dirent.name, path: getRelativePath(fullPath), isDir, score });
                    if (!isDir) continue;
                }
                if (isDir) await searchDir(fullPath, depth + 1);
            }
        } catch (e) {
            logger.debug(`Search dir error: ${e.message}`);
        }
    };

    for (const dir of searchDirs) {
        await searchDir(dir, 0);
    }

    results.sort((a, b) => b.score - a.score);
    const top = results.slice(0, maxResults);
    const folders = top.filter(r => r.isDir).map(r => ({ name: r.name, path: r.path }));
    const files = top.filter(r => !r.isDir).map(r => ({ name: r.name, path: r.path }));
    return { files, folders };
}

module.exports = {
    schema: z.object({ query: z.string().describe('The file or folder name keyword to search for') }),
    name: 'searchFiles',
    description: 'Search for files, folders, and apps on the system',
    tags: ['search', 'file', 'find'],

    returnType: 'data',
    marker: 'silently',
    ui: 'card-list',

    examples: [
        { user: 'find my  <file name>', action: '[action: searchFiles, query:  <file name>]' },
        { user: 'where is Chrome', action: '[action: searchFiles, query: Chrome]' },
        { user: 'look for report.pdf', action: '[action: searchFiles, query: report.pdf]' },
        { user: 'search for my documents', action: '[action: searchFiles, query: documents]' },
    ],

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
