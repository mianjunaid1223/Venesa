// IPC Query Handlers — handles text-based queries from the renderer.
// Uses the shared query-pipeline for all LLM → process → verbalize logic.
const { ipcMain } = require('electron');
const logger = require('../../lib/logger');
const { executeQuery, dispatchResults } = require('./query-pipeline');

function register() {
    ipcMain.on('send-to-gemini', async (event, query) => {
        try {
            if (!query || typeof query !== 'string' || !query.trim()) {
                if (event.sender && !event.sender.isDestroyed()) {
                    event.sender.send('gemini-response', 'No input received.');
                }
                return;
            }

            const result = await executeQuery({ query, imageData: null, mode: 'text' });

            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('gemini-response', result.text);
            }

            // Dispatch UI events
            dispatchResults(event.sender, result);

            // Handle missing env key feedback
            const missingKey = result.results.find(r => r.envKey);
            if (missingKey && event.sender && !event.sender.isDestroyed()) {
                const msg = `To use this capability, add the key '${missingKey.envKey}' in Settings → Custom Keys, then try again.`;
                if (result.text === 'Done.') {
                    event.sender.send('gemini-response', msg);
                }
            }

        } catch (error) {
            logger.error(`[query] Error processing query: ${error.message}`);
            if (event.sender && !event.sender.isDestroyed()) {
                event.sender.send('gemini-response', 'Something went wrong. Try again.');
            }
        }
    });
}

module.exports = { register };
