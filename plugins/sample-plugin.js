/**
 * Venesa Sample Plugin
 *
 * PLUGIN STANDARD SCHEMA:
 *  - name:        string  — unique camelCase ID used by the AI as a tool name
 *  - description: string  — shown in Settings and injected into the AI prompt
 *  - ui:          string  — 'table' | 'key-value' | 'card-list' | 'commandList' (optional)
 *  - handler:     async (params) => any  — REQUIRED
 *
 * The AI decides when to call your plugin based on name + description.
 * handler(params) receives parameters the AI passes.
 */
const { z } = require('zod');

module.exports = {
    schema: z.object({}),


    name: 'samplePlugin',
    description: 'Returns a custom greeting and a sample data table. ONLY use when the user EXPLICITLY asks to "test the table plugin" or "show the sample plugin". Do NOT use for general UI questions.',
    ui: 'table',
    enabled: true,

    handler: async (params) => {
        const query = params.query || params.text || '';

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
