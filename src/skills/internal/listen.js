/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: listen
 *  Continue listening for voice input.
 * ═══════════════════════════════════════════════════════════════
 */
const { z } = require('zod');

module.exports = {
    schema: z.object({}),
    name: 'listen',
    description: 'Continue listening for voice input',
    tags: ['voice', 'listen'],

    returnType: 'action',
    marker: 'silently',
    ui: null,

    examples: [

        { user: '(used internally after asking a question)', action: '[action: listen]' },

    ],


    async handler() {
        return 'Listening';
    },
};
