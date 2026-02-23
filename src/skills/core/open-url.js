/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: open-url
 *  Open a URL in the default browser.
 * ═══════════════════════════════════════════════════════════════
 */

const { shell } = require('electron');

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

module.exports = {
    name: 'openUrl',
    description: 'Open a URL in the default browser',
    tags: ['web', 'url', 'browse'],
    permission: 'normal',
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
