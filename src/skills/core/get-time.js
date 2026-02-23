/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-time
 *  Get current date and time.
 * ═══════════════════════════════════════════════════════════════
 */

module.exports = {
    name: 'getTime',
    description: 'Get current date and time',
    tags: ['time', 'date'],
    permission: 'safe',
    marker: 'silently',
    ui: null,

    handler() {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
        const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        return JSON.stringify({ time: timeStr, date: dateStr, full: `${timeStr} on ${dateStr}` });
    },
};
