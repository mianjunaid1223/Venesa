/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: remove-command
 *  Remove a custom voice command.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const memory = require('../../brain/memory');

module.exports = {
    schema: z.object({ trigger: z.string().describe('The trigger phrase to remove') }),
    name: 'removeCommand',
    description: 'Remove a custom voice command',
    tags: ['command', 'remove', 'delete'],

    returns: 'none',
    marker: 'announce',
    ui: null,

    handler(params) {
        if (!params?.trigger) {
            return JSON.stringify({ success: false, error: 'Missing trigger phrase' });
        }
        try {
            const result = memory.removeCustomCommand(params.trigger);
            return JSON.stringify(result || { success: true, removed: params.trigger });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
