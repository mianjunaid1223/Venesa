/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: set-clipboard
 *  Set clipboard text content.
 * ═══════════════════════════════════════════════════════════════
 */

const { clipboard } = require('electron');

module.exports = {
    name: 'setClipboard',
    description: 'Set clipboard text content',
    tags: ['clipboard', 'write', 'copy'],
    permission: 'normal',
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
