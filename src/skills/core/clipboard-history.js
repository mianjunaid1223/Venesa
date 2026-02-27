/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: clipboard-history
 *  Track clipboard changes, browse history, paste from history.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { clipboard } = require('electron');

const MAX_HISTORY = 25;
const history = [];
const pinned = [];
let lastContent = '';
let pollingInterval = null;

function startPolling() {
    if (pollingInterval) return;
    pollingInterval = setInterval(() => {
        try {
            const current = clipboard.readText() || '';
            if (current && current !== lastContent && current.trim().length > 0) {
                lastContent = current;
                const existing = history.findIndex(h => h.text === current);
                if (existing !== -1) history.splice(existing, 1);
                history.unshift({
                    text: current,
                    timestamp: Date.now(),
                    preview: current.substring(0, 80) + (current.length > 80 ? '...' : ''),
                });
                while (history.length > MAX_HISTORY) history.pop();
            }
        } catch { /* ignore clipboard read errors */ }
    }, 2000);
}

// Parse index — supports "P0" for pinned, numeric for history
function parseIndex(idx) {
    if (typeof idx === 'string' && /^[Pp]\d+$/.test(idx)) {
        return { source: 'pinned', num: parseInt(idx.substring(1), 10) };
    }
    return { source: 'history', num: typeof idx === 'number' ? idx : parseInt(idx || '0', 10) };
}

module.exports = {
    schema: z.object({
        operation: z.enum(['list', 'get', 'paste', 'pin', 'unpin', 'clear', 'search']).describe('Operation'),
        index: z.union([z.number(), z.string()]).optional().describe('History index (0 = most recent) or "P0" for pinned items'),
        query: z.string().optional().describe('Search query for search operation'),
    }),
    name: 'clipboardHistory',
    description: 'Browse clipboard history, paste from history, pin items, search. Operations: list, get, paste, pin, unpin, clear, search',
    tags: ['clipboard', 'history', 'paste', 'pin'],

    returnType: 'hybrid',
    marker: 'silently',
    ui: null,

    lifecycle: {
        onLoad() { startPolling(); },
        onUnload() {
            if (pollingInterval) {
                clearInterval(pollingInterval);
                pollingInterval = null;
            }
        },
    },

    handler(params) {
        const { operation, index, query } = params;

        switch (operation) {
            case 'list': {
                const items = [
                    ...pinned.map((p, i) => ({ index: `P${i}`, text: p.preview, pinned: true, time: new Date(p.timestamp).toLocaleTimeString() })),
                    ...history.map((h, i) => ({ index: i, text: h.preview, pinned: false, time: new Date(h.timestamp).toLocaleTimeString() })),
                ];
                if (items.length === 0) return JSON.stringify({ empty: true, message: 'No clipboard history yet.' });
                return JSON.stringify({ items, total: items.length });
            }

            case 'get': {
                const { source, num } = parseIndex(index ?? 0);
                const arr = source === 'pinned' ? pinned : history;
                if (num < 0 || num >= arr.length) {
                    return JSON.stringify({ error: `No ${source} item at index ${num}. ${source} has ${arr.length} items.` });
                }
                return arr[num].text;
            }

            case 'paste': {
                const { source, num } = parseIndex(index ?? 0);
                const arr = source === 'pinned' ? pinned : history;
                if (num < 0 || num >= arr.length) {
                    return JSON.stringify({ error: `No ${source} item at index ${num}.` });
                }
                clipboard.writeText(arr[num].text);
                return JSON.stringify({ success: true, pasted: arr[num].preview });
            }

            case 'pin': {
                const idx = typeof index === 'number' ? index : parseInt(index || '0', 10);
                if (idx < 0 || idx >= history.length) {
                    return JSON.stringify({ error: `No history item at index ${idx}.` });
                }
                const item = history.splice(idx, 1)[0];
                pinned.push(item);
                return JSON.stringify({ success: true, pinned: item.preview });
            }

            case 'unpin': {
                const idx = typeof index === 'number' ? index : parseInt(index || '0', 10);
                if (idx < 0 || idx >= pinned.length) {
                    return JSON.stringify({ error: `No pinned item at index ${idx}.` });
                }
                const unpinned = pinned.splice(idx, 1)[0];
                history.unshift(unpinned);
                while (history.length > MAX_HISTORY) history.pop();
                return JSON.stringify({ success: true, unpinned: unpinned.preview });
            }

            case 'clear': {
                history.length = 0;
                return JSON.stringify({ success: true, message: 'Clipboard history cleared.' });
            }

            case 'search': {
                if (!query) return JSON.stringify({ error: 'Search query required.' });
                const lower = query.toLowerCase();
                const results = [];
                for (let i = 0; i < pinned.length; i++) {
                    if (pinned[i].text.toLowerCase().includes(lower)) {
                        results.push({ index: `P${i}`, text: pinned[i].preview, source: 'pinned' });
                    }
                }
                for (let i = 0; i < history.length; i++) {
                    if (history[i].text.toLowerCase().includes(lower)) {
                        results.push({ index: i, text: history[i].preview, source: 'history' });
                    }
                }
                return JSON.stringify({ results, total: results.length });
            }

            default:
                return JSON.stringify({ error: `Unknown operation: ${operation}` });
        }
    },
};
