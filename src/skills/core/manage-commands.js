/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: manage-commands
 *  Save, remove, and list custom voice command shortcuts.
 * ═══════════════════════════════════════════════════════════════
 */

const memory = require('../../brain/memory');

module.exports = {
    name: 'saveCommand',
    description: 'Save a custom voice command shortcut',
    tags: ['command', 'shortcut', 'custom', 'remember'],
    permission: 'normal',
    marker: 'announce',
    ui: null,

    handler(params) {
        if (!params.trigger) {
            return JSON.stringify({ success: false, error: 'Missing trigger phrase' });
        }

        let actions;
        try {
            actions = typeof params.actions === 'string'
                ? JSON.parse(params.actions)
                : params.actions;
        } catch (e) {
            return JSON.stringify({ success: false, error: 'Invalid actions format' });
        }

        if (!Array.isArray(actions) || actions.length === 0) {
            return JSON.stringify({ success: false, error: 'Actions must be a non-empty array' });
        }

        try {
            const result = memory.addCustomCommand(
                params.trigger,
                actions,
                params.description || ''
            );
            return JSON.stringify(result);
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
