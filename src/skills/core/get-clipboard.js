/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-clipboard
 *  Read text from the clipboard.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { clipboard } = require('electron');

module.exports = {
    schema: z.object({}),
    name: 'getClipboard',
    description: 'Read text from the clipboard',
    tags: ['clipboard', 'read'],

    returns: 'data',
    marker: 'silently',
    ui: null,

    handler() {
        try {
            return clipboard.readText() || '(clipboard is empty)';
        } catch (e) {
            return 'Failed to read clipboard.';
        }
    },
};
