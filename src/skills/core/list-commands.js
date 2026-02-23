/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: list-commands
 *  List all saved custom voice commands.
 * ═══════════════════════════════════════════════════════════════
 */

const memory = require('../../brain/memory');

module.exports = {
    name: 'listCommands',
    description: 'List all saved custom voice commands',
    tags: ['command', 'list', 'shortcuts'],
    permission: 'safe',
    marker: 'announce',
    ui: 'command-list',

    handler() {
        const cmds = memory.getCustomCommands();
        if (cmds.length === 0) {
            return JSON.stringify({ customCommands: [], message: 'No custom commands saved yet.' });
        }
        return JSON.stringify({ customCommands: cmds, count: cmds.length });
    },
};
