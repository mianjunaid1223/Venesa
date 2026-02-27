/**
 * ═══════════════════════════════════════════════════════════════
 *  PLUGIN: quick-note
 *  Capture and retrieve quick notes by voice or text.
 *  Persistent via memory system.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const memory = require('../src/brain/memory');
const logger = require('../src/lib/logger');

const BUCKET = 'context';
const KEY = 'quickNotes';

function getNotes() {
    try {
        return memory.get(BUCKET, KEY) || [];
    } catch (e) {
        logger.warn(`[quick-note] Failed to read notes: ${e?.message ?? String(e)}`);
        return [];
    }
}

function saveNotes(notes) {
    try {
        memory.set(BUCKET, KEY, notes);
        return true;
    } catch (e) {
        logger.warn(`[quick-note] Failed to save notes: ${e?.message ?? String(e)}`);
        return false;
    }
}

module.exports = {
    name: 'quickNote',
    description: 'Save and retrieve quick notes. Operations: add, list, search, delete, clear',
    tags: ['note', 'memo', 'reminder', 'save', 'write'],

    returnType: 'hybrid',
    marker: 'silently',
    ui: null,

    schema: z.object({
        operation: z.enum(['add', 'list', 'search', 'delete', 'clear']).describe('Operation'),
        text: z.string().optional().describe('Note text (for add/search)'),
        index: z.number().optional().describe('Note index (for delete)'),
    }),

    handler(params) {
        const { operation, text, index } = params;
        const notes = getNotes();

        switch (operation) {
            case 'add': {
                if (!text) return JSON.stringify({ error: 'Note text required.' });
                notes.unshift({
                    text,
                    created: new Date().toISOString(),
                    id: Date.now(),
                });
                saveNotes(notes);
                return JSON.stringify({ success: true, total: notes.length });
            }

            case 'list': {
                if (notes.length === 0) return JSON.stringify({ empty: true });
                const items = notes.map((n, i) => ({
                    index: i,
                    text: n.text,
                    date: new Date(n.created).toLocaleDateString(),
                }));
                return JSON.stringify({ notes: items, total: items.length });
            }

            case 'search': {
                if (!text) return JSON.stringify({ error: 'Search text required.' });
                const lower = text.toLowerCase();
                const results = [];
                for (let i = 0; i < notes.length; i++) {
                    if (notes[i].text.toLowerCase().includes(lower)) {
                        results.push({
                            index: i,
                            text: notes[i].text,
                            date: new Date(notes[i].created).toLocaleDateString(),
                        });
                    }
                }
                return JSON.stringify({ results, total: results.length });
            }

            case 'delete': {
                const idx = index ?? 0;
                if (idx < 0 || idx >= notes.length) {
                    return JSON.stringify({ error: `No note at index ${idx}.` });
                }
                const removed = notes.splice(idx, 1)[0];
                saveNotes(notes);
                return JSON.stringify({ success: true, deleted: removed.text });
            }

            case 'clear': {
                saveNotes([]);
                return JSON.stringify({ success: true, message: 'All notes cleared.' });
            }

            default:
                return JSON.stringify({ error: `Unknown operation: ${operation}` });
        }
    },
};
