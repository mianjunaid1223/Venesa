/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-clipboard
 *  Read text from the clipboard.
 * ═══════════════════════════════════════════════════════════════
 */

const { clipboard } = require('electron');

module.exports = {
    name: 'getClipboard',
    description: 'Read text from the clipboard',
    tags: ['clipboard', 'read'],
    permission: 'safe',
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
