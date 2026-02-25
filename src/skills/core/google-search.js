/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: google-search
 *  Search Google for a query and open results in browser.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { shell } = require('electron');

module.exports = {
    schema: z.object({ query: z.string().trim().min(1).describe('The search query') }),
    name: 'googleSearch',
    description: 'Search Google for a query and open results in browser',
    tags: ['web', 'search', 'google'],

    returns: 'none',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const query = params.query;
        if (!query || typeof query !== 'string' || !query.trim()) {
            return 'No search query provided.';
        }
        const url = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
        try {
            await shell.openExternal(url);
            return `Searching Google for: ${query.trim()}`;
        } catch (e) {
            return `Error opening browser: ${e.message}`;
        }
    },
};
