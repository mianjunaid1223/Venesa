/**
 * Venesa Sample Plugin
 *
 * PLUGIN STANDARD SCHEMA (Unified Protocol):
 *  - name:        string  — unique camelCase ID used by the AI as a tool name
 *  - description: string  — shown in Settings and injected into the AI prompt
 *  - returnType:  'data'|'action'|'ui'|'memory'|'hybrid' — REQUIRED
 *  - ui:          string  — 'table'|'key-value'|'card-list'|'command-list' (optional)
 *  - schema:      ZodObject — parameter validation schema
 *  - handler:     async (params) => any — REQUIRED
 *
 * The AI decides when to call your plugin based on name + description.
 * handler(params) receives parameters the AI passes.
 */
const { z } = require('zod');

module.exports = {
    name: 'samplePlugin',
    description: 'Returns a custom greeting and a sample data table. ONLY use when the user EXPLICITLY asks to "test the table plugin" or "show the sample plugin". Do NOT use for general UI questions.',

    returnType: 'data',
    ui: 'table',
    enabled: true,

    schema: z.object({
        query: z.string().optional().describe('The user query to demonstrate the plugin.'),
        text: z.string().optional().describe('Fallback text input.'),
    }),

    examples: [
        { user: 'test the table plugin', action: '[action: samplePlugin]' },
    ],

    handler: async (params) => {
        const raw = params.query || params.text || '';
        const query = raw.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

        const data = [
            { id: 1, Name: 'Sample Item A', Status: 'Active', Value: 100 },
            { id: 2, Name: 'Sample Item B', Status: 'Inactive', Value: 0 },
            { id: 3, Name: query || 'Dynamic Entry', Status: 'Pending', Value: 42 },
        ];

        return {
            success: true,
            message: `Hello from the sample plugin! You said: "${query || 'Nothing'}"`,
            data,
        };
    },
};
