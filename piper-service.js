/**
 * Piper Service - Now using ElevenLabs TTS
 * This module provides TTS functionality using ElevenLabs
 */

const elevenlabsService = require('./elevenlabs-service.js');

/**
 * Check if TTS service is available
 * @returns {boolean}
 */
function isAvailable() {
    return elevenlabsService.isAvailable();
}

/**
 * Synthesize text to speech and return as data URL
 * @param {string} text - Text to synthesize
 * @returns {Promise<string>} Audio data URL
 */
async function synthesizeToDataURL(text) {
    if (!elevenlabsService.isAvailable()) {
        console.error('[TTS] ElevenLabs not configured');
        return null;
    }

    try {
        const dataUrl = await elevenlabsService.synthesizeToDataURL(text);
        return dataUrl;
    } catch (error) {
        console.error('[TTS] Synthesis error:', error);
        return null;
    }
}

/**
 * Synthesize text to buffer (for file saving)
 * @param {string} text - Text to synthesize
 * @returns {Promise<Buffer>} Audio buffer
 */
async function synthesize(text) {
    const dataUrl = await synthesizeToDataURL(text);
    if (!dataUrl) return null;

    // Convert data URL to buffer
    const base64 = dataUrl.split(',')[1];
    return Buffer.from(base64, 'base64');
}

module.exports = {
    isAvailable,
    synthesize,
    synthesizeToDataURL
};
