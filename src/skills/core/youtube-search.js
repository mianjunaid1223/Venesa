/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: youtube-search
 *  Search YouTube for a query and open results in browser.
 * ═══════════════════════════════════════════════════════════════
 */

const { shell } = require('electron');

module.exports = {
    name: 'youtubeSearch',
    description: 'Search YouTube for a query and open results in browser',
    tags: ['web', 'search', 'youtube', 'video'],
    permission: 'safe',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const query = params.query;
        if (!query || typeof query !== 'string' || !query.trim()) {
            return 'No search query provided.';
        }
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
        try {
            await shell.openExternal(url);
            return `Searching YouTube for: ${query}`;
        } catch (e) {
            return `Error opening browser: ${e.message}`;
        }
    },
};
