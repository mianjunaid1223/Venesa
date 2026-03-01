/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: clipboard
 *  Read and write system clipboard. Unified from get/set.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { clipboard } = require('electron');

module.exports = {
    schema: z.object({
        operation: z.enum(['read', 'write']).describe('read or write'),
        text: z.string().optional().describe('Text to write (only for write operation)'),
    }),
    name: 'clipboard',
    description: 'Read from or write to system clipboard',
    tags: ['clipboard', 'copy', 'paste', 'read', 'write'],

    returnType: 'hybrid',
    marker: 'silently',
    ui: null,

    examples: [

        { user: 'what did I copy', action: '[action: clipboard, operation: read]' },

        { user: 'copy this text hello world', action: '[action: clipboard, operation: write, text: hello world]' },

    ],


    handler(params) {
        try {
            if (params.operation === 'write') {
                if (!params.text || !params.text.trim()) return 'No text to copy.';
                clipboard.writeText(params.text);
                return 'Copied to clipboard.';
            } else {
                const text = clipboard.readText();
                return text || '(clipboard is empty)';
            }
        } catch (e) {
            return `Clipboard error: ${e.message}`;
        }
    },
};
