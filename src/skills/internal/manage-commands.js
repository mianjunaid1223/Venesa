/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: manage-commands
 *  Save, remove, and list custom voice command shortcuts.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const memory = require('../../brain/memory');

module.exports = {
    schema: z.object({
        trigger: z.string().trim().min(1).describe('The trigger phrase'),
        actions: z.string().optional().describe('The action or plan string'),
        plan: z.string().optional().describe('Alias for actions — the plan string'),
        description: z.string().optional().describe('Short description of what the command does'),
    }),
    name: 'saveCommand',
    description: 'Save a custom voice command shortcut',
    tags: ['command', 'shortcut', 'custom', 'remember'],

    returnType: 'memory',
    marker: 'announce',
    ui: null,

    handler(params) {
        if (!params.trigger || !params.trigger.trim()) {
            return JSON.stringify({ success: false, error: 'Missing trigger phrase' });
        }

        // Accept either "actions" or "plan" parameter
        let actions = params.actions || params.plan || '';
        if (typeof actions !== 'string') {
            actions = String(actions);
        }
        actions = actions.trim();

        if (!actions) {
            return JSON.stringify({ success: false, error: 'Missing actions — provide the [plan] block as the actions parameter.' });
        }

        try {
            const result = memory.addCustomCommand(
                params.trigger.trim(),
                actions,
                params.description || ''
            );
            return JSON.stringify(result);
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
