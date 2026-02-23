/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: remove-command
 *  Remove a custom voice command.
 * ═══════════════════════════════════════════════════════════════
 */

const memory = require('../../brain/memory');

module.exports = {
    name: 'removeCommand',
    description: 'Remove a custom voice command',
    tags: ['command', 'remove', 'delete'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    handler(params) {
        if (!params?.trigger) {
            return JSON.stringify({ success: false, error: 'Missing trigger phrase' });
        }
        try {
            const result = memory.removeCustomCommand(params.trigger);
            return JSON.stringify(result);
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
