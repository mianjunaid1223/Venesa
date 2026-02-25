/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: set-clipboard
 *  Set clipboard text content.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { clipboard } = require('electron');

module.exports = {
    schema: z.object({ text: z.string().trim().min(1).describe('The text to copy to the clipboard') }),
    name: 'setClipboard',
    description: 'Set clipboard text content',
    tags: ['clipboard', 'write', 'copy'],

    returns: 'none',
    marker: 'silently',
    ui: null,

    handler(params) {
        if (!params || !params.text || typeof params.text !== 'string' || !params.text.trim()) {
            return 'No text to copy.';
        }
        try {
            clipboard.writeText(params.text);
            return 'Copied to clipboard.';
        } catch (e) {
            return 'Failed to write to clipboard.';
        }
    },
};
