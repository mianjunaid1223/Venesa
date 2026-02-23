/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-weather
 *  Open weather information for a location.
 * ═══════════════════════════════════════════════════════════════
 */

const { shell } = require('electron');

module.exports = {
    name: 'getWeather',
    description: 'Open weather information for a location',
    tags: ['weather', 'forecast'],
    permission: 'safe',
    marker: 'announce',
    ui: null,

    async handler(params) {
        const location = params?.location || '';
        const query = location ? `weather ${location}` : 'weather';
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        try {
            await shell.openExternal(url);
            return location ? `Checking weather for ${location}` : 'Opening weather info';
        } catch (e) {
            return `Failed to open browser: ${e.message}`;
        }
    },
};
