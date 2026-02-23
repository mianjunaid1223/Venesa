/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: set-memory
 *  Write to memory buckets.
 * ═══════════════════════════════════════════════════════════════
 */

const memory = require('../../brain/memory');

module.exports = {
    name: 'setMemory',
    description: 'Write a value to a memory bucket',
    tags: ['memory', 'write', 'remember'],
    permission: 'normal',
    marker: 'silently',
    ui: null,

    handler(params) {
        const bucket = params.bucket;
        const key = params.key;
        const value = params.value;

        if (!bucket || !memory.BUCKETS.includes(bucket)) {
            return JSON.stringify({ error: `Invalid bucket. Use one of: ${memory.BUCKETS.join(', ')}` });
        }

        if (!key || typeof key !== 'string') {
            return JSON.stringify({ error: 'Missing key' });
        }

        if (value === undefined || value === null) {
            memory.remove(bucket, key);
            return JSON.stringify({ success: true, action: 'removed', bucket, key });
        }

        memory.set(bucket, key, value);
        return JSON.stringify({ success: true, action: 'saved', bucket, key, value });
    },
};
