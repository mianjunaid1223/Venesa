const { z } = require('zod');
const { shell } = require('electron');

const ALLOWED_SCHEMES = ['http:', 'https:', 'mailto:'];

module.exports = {
    schema: z.object({ url: z.string().url().describe('The URL to open') }),
    name: 'openUrl',
    description: 'Open a URL in the default browser',
    tags: ['web', 'url', 'browse'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'open github.com', action: '[action: openUrl, url: https://github.com]' },

        { user: 'go to youtube', action: '[action: openUrl, url: https://youtube.com]' },

    ],


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
            return `Invalid URL: ${e instanceof Error ? e.message : String(e)}`;
        }
    },
};
