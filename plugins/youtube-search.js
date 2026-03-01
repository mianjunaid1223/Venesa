/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: youtube-search
 *  Search YouTube for a query and open results in browser.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { shell } = require('electron');

module.exports = {
    schema: z.object({ query: z.string().trim().min(1).describe('The search query') }),
    name: 'youtubeSearch',
    description: 'Search YouTube for a query and open results in browser',
    tags: ['web', 'search', 'youtube', 'video'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'search YouTube for lo-fi music', action: '[action: youtubeSearch, query: lo-fi music]' },

    ],


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
