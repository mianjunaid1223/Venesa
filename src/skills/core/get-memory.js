/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-memory
 *  Read from memory buckets.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const memory = require('../../brain/memory');

module.exports = {
    schema: z.object({
        bucket: z.enum(['preferences', 'context', 'aliases', 'history']).describe('The memory bucket'),
        key: z.string().optional().describe('The memory key to retrieve'),
    }),
    name: 'getMemory',
    description: 'Read a value from a memory bucket',
    tags: ['memory', 'read', 'remember'],

    returns: 'data',
    marker: 'silently',
    ui: null,

    handler(params) {
        const bucket = params.bucket;
        const key = params.key;

        if (!bucket || !memory.BUCKETS.includes(bucket)) {
            return JSON.stringify({ error: `Invalid bucket. Use one of: ${memory.BUCKETS.join(', ')}` });
        }

        if (key) {
            const value = memory.get(bucket, key);
            return JSON.stringify({ bucket, key, value: value ?? null });
        }

        const all = memory.get(bucket);
        return JSON.stringify({ bucket, data: all });
    },
};
