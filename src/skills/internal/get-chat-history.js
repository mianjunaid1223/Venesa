/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-chat-history
 *  Retrieve the recent conversational context on demand.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const memory = require('../../brain/memory');

module.exports = {
    schema: z.object({
        count: z.number().optional().describe('Number of recent interactions to retrieve (default 5, max 20)'),
    }),
    name: 'getChatHistory',
    description: 'Retrieve recent conversation history with the user on demand',
    tags: ['history', 'context', 'memory', 'chat', 'recent'],

    returnType: 'data',
    marker: 'silently',
    ui: null,

    examples: [
        { user: 'what was the last thing I said', action: '[action: getChatHistory, count: 1]' },
        { user: 'can you repeat that', action: '[action: getChatHistory, count: 2]' },
        { user: 'what were we just talking about', action: '[action: getChatHistory, count: 5]' },
    ],

    handler(params) {
        let count = params.count ?? 5;
        count = Math.min(Math.max(count, 0), 20);
        const history = memory.get('history') || {};
        const recent = history.recent || [];

        if (count === 0) {
            return JSON.stringify({ recentInteractions: [] });
        }

        if (recent.length === 0) {
            return JSON.stringify({ message: "No recent conversation history available." });
        }

        const lastN = recent.slice(-count);
        return JSON.stringify({ recentInteractions: lastN });
    },
};
