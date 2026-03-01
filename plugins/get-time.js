/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-time
 *  Get current date and time.
 * ═══════════════════════════════════════════════════════════════
 */
const { z } = require('zod');

module.exports = {
    schema: z.object({}),
    name: 'getTime',
    description: 'Get the current date and time',
    tags: ['time', 'date'],

    returnType: 'data',
    marker: 'silently',
    ui: null,

    examples: [

        { user: 'what time is it', action: '[action: getTime]' },

    ],


    handler() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        return JSON.stringify({ time: timeStr, date: dateStr, full: `${timeStr} on ${dateStr}` });
    },
};
