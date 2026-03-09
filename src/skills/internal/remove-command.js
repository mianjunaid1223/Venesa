const { z } = require('zod');
const memory = require('../../brain/memory');

module.exports = {
    schema: z.object({ trigger: z.string().describe('The trigger phrase to remove') }),
    name: 'removeCommand',
    description: 'Remove a custom voice command',
    tags: ['command', 'remove', 'delete'],

    returnType: 'memory',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'delete the goodnight command', action: '[action: removeCommand, trigger: goodnight]' },

    ],


    async handler(params) {
        if (!params?.trigger) {
            return JSON.stringify({ success: false, error: 'Missing trigger phrase' });
        }
        try {
            const result = memory.removeCustomCommand(params.trigger);
            if (!result) {
                return JSON.stringify({ success: false, error: 'not found' });
            }
            if (result === true || result.success === true) {
                return JSON.stringify({ success: true, removed: params.trigger });
            }
            // result is already an object — merge into success shape
            return JSON.stringify({ success: true, removed: params.trigger, ...result });
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
