/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: set-memory
 *  Write to memory buckets.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const memory = require('../../brain/memory');

module.exports = {
    schema: z.object({
        bucket: z.enum(memory.BUCKETS || ['preferences', 'context', 'aliases', 'history']).describe('The memory bucket'),
        key: z.string().describe('The memory key to set'),
        value: z.string().optional().describe('The value to store (omit to remove)'),
    }),
    name: 'setMemory',
    description: 'Write a value to a memory bucket, or remove it by omitting the value',
    tags: ['memory', 'write', 'remember'],

    returnType: 'memory',
    marker: 'silently',
    ui: null,

    examples: [

        { user: '(internal) save user preference', action: '[action: setMemory, bucket: preferences, key: theme, value: dark]' },

    ],


    async handler(params) {
        const bucket = params.bucket;
        const key = params.key;
        const value = params.value;

        const buckets = memory.BUCKETS || ['preferences', 'context', 'aliases', 'history'];
        if (!bucket || !buckets.includes(bucket)) {
            return JSON.stringify({ error: `Invalid bucket. Use one of: ${buckets.join(', ')}` });
        }

        if (!key || typeof key !== 'string') {
            return JSON.stringify({ error: 'Missing key' });
        }

        try {
            if (value === undefined || value === null || value === "") {
                memory.remove(bucket, key);
                return JSON.stringify({ success: true, action: 'removed', bucket, key });
            }

            memory.set(bucket, key, value);
            return JSON.stringify({ success: true, action: 'saved', bucket, key });
        } catch (err) {
            return JSON.stringify({ success: false, error: err.message, bucket, key });
        }
    },
};
