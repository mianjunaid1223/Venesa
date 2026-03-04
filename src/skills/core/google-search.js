/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: google-search
 *  Search Google for a query and open results in browser.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { shell } = require('electron');
const connectivity = require('../../lib/connectivity');

module.exports = {
    schema: z.object({ query: z.string().trim().min(1).describe('The search query') }),
    name: 'googleSearch',
    description: 'Search Google for a query and open results in browser',
    tags: ['web', 'search', 'google'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'google best restaurants near me', action: '[action: googleSearch, query: best restaurants near me]' },

        { user: 'search the web for Python tutorials', action: '[action: googleSearch, query: Python tutorials]' },

    ],


    async handler(params) {
        if (!connectivity.isOnline()) {
            return { success: false, error: 'No internet connection. Please check your connection and try again.' };
        }
        const query = params.query;
        if (!query || typeof query !== 'string' || !query.trim()) {
            return { success: false, error: 'No search query provided.' };
        }
        const url = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
        try {
            await shell.openExternal(url);
            return { success: true, result: `Searching Google for: ${query.trim()}` };
        } catch (e) {
            return { success: false, error: `Error opening browser: ${e.message}` };
        }
    },
};
