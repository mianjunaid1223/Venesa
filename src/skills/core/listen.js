/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: listen
 *  Continue listening for voice input.
 * ═══════════════════════════════════════════════════════════════
 */

module.exports = {
    name: 'listen',
    description: 'Continue listening for voice input',
    tags: ['voice', 'listen'],
    permission: 'safe',
    marker: 'silently',
    ui: null,

    handler() {
        return 'Listening';
    },
};
