/**
 * Venesa Sample Plugin
 * This is an example of an external skill loaded dynamically from the plugins folder.
 */

module.exports = {
    name: 'sample-plugin',
    description: 'A sample external plugin that returns a custom greeting and a dummy data table.',
    permission: 'normal',

    // Explicit trigger (e.g., typing "hello") bypasses the LLM entirely
    trigger: 'hello',

    // Suggest to the UI which dynamic component should display the output
    ui: 'table',

    execute: async (query, context) => {
        // You can use context.llm to prompt the AI within your skill if needed
        // You can run any Node.js code here

        // Example: generate some dummy data for a table
        const data = [
            { id: 1, Name: 'Sample Item A', Status: 'Active', Value: 100 },
            { id: 2, Name: 'Sample Item B', Status: 'Inactive', Value: 0 },
            { id: 3, Name: query || 'Dynamic Entry', Status: 'Pending', Value: 42 },
        ];

        return {
            success: true,
            message: `Hello from the sample plugin! You said: "${query || 'Nothing'}"`,
            data: data
        };
    }
};
