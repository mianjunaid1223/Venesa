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

    returns: 'none',
    marker: 'silently',
    ui: null,

    handler() {
        return 'Listening';
    },
};
