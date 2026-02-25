/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: open-url
 *  Open a URL in the default browser.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { shell } = require('electron');

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

module.exports = {
    schema: z.object({ url: z.string().url().describe('The URL to open') }),
    name: 'openUrl',
    description: 'Open a URL in the default browser',
    tags: ['web', 'url', 'browse'],

    returns: 'none',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const url = params?.url;
        if (!url || typeof url !== 'string') {
            return 'No URL provided.';
        }

        try {
            const parsed = new URL(url);
            if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
                return `Blocked: ${parsed.protocol} URLs are not allowed.`;
            }
            await shell.openExternal(parsed.href);
            return `Opened ${parsed.href}`;
        } catch (e) {
            return `Invalid URL: ${e.message}`;
        }
    },
};
