/**
 * ═══════════════════════════════════════════════════════════════
 *  SKILL: get-weather
 *  Open weather information for a location.
 * ═══════════════════════════════════════════════════════════════
 */

const { z } = require('zod');
const { shell } = require('electron');

module.exports = {
    schema: z.object({ location: z.string().optional() }),
    name: 'getWeather',
    description: 'Open weather information for a location',
    tags: ['weather', 'forecast'],

    returnType: 'action',
    marker: 'announce',
    ui: null,

    examples: [

        { user: 'what is the weather in London', action: '[action: getWeather, location: London]' },

    ],


    async handler(params) {
        const location = params?.location || '';
        const query = location ? `weather ${location}` : 'weather';
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
        try {
            await shell.openExternal(url);
            return location ? `Checking weather for ${location}` : 'Opening weather info';
        } catch (e) {
            return JSON.stringify({ success: false, error: e.message });
        }
    },
};
