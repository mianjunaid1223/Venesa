/**
 * ElevenLabs API Key Pool Manager
 * 
 * Features:
 * - Round-robin key rotation between multiple keys
 * - Automatic failover when a key hits rate limits
 * - 60-second cooldown for rate-limited keys
 * - Automatic removal of invalid/revoked keys
 * - Usage statistics tracking per key
 */

const fs = require('fs');
const path = require('path');

// Constants
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown
const INVALID_KEY_ERRORS = [401, 403, 'xi-api-key_invalid', 'permission_denied'];
const RATE_LIMIT_ERRORS = [429, 'quota_exceeded', 'rate_limit_exceeded'];

class ElevenLabsKeyPool {
    constructor() {
        this.keys = [];
        this.currentIndex = 0;
        this.initialized = false;
        this.stats = new Map();
        this.currentKey = null; // Pre-selected key for immediate use
    }

    /**
     * Initialize the key pool by loading keys from .env file
     * @returns {boolean} True if at least one key was loaded successfully
     */
    initialize() {
        this.keys = [];
        this.stats.clear();
        this.currentIndex = 0;

        // Load keys from .env file
        const envPath = path.join(process.cwd(), '.env');

        if (!fs.existsSync(envPath)) {
            console.warn('[ElevenLabsKeyPool] No .env file found at:', envPath);
            this.initialized = false;
            return false;
        }

        try {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const lines = envContent.split('\n');

            for (const line of lines) {
                const trimmedLine = line.trim();

                // Skip comments and empty lines
                if (!trimmedLine || trimmedLine.startsWith('#')) continue;

                // Match ELEVENLABS_API_KEY or ELEVENLABS_API_KEY_1, ELEVENLABS_API_KEY_2, etc.
                const match = trimmedLine.match(/^ELEVENLABS_API_KEY(?:_\d+)?=(.+)$/);

                if (match) {
                    const key = match[1].trim().replace(/["']/g, ''); // Remove quotes

                    if (key && key.length > 0) {
                        this._addKey(key);
                    }
                }
            }

            this.initialized = this.keys.length > 0;

            if (this.initialized) {
                // Pre-select first available key at startup
                this.currentKey = this._selectNextAvailableKey();
            }

            return this.initialized;

        } catch (error) {
            console.error('[ElevenLabsKeyPool] Error reading .env file:', error.message);
            this.initialized = false;
            return false;
        }
    }

    /**
     * Add a key to the pool with initial stats
     * @private
     * @param {string} key - The API key to add
     */
    _addKey(key) {
        if (this.keys.includes(key)) {
            console.warn('[ElevenLabsKeyPool] Duplicate key ignored');
            return;
        }

        this.keys.push(key);
        this.stats.set(key, {
            successCount: 0,
            errorCount: 0,
            rateLimitHits: 0,
            isActive: true,
            isRevoked: false,
            cooldownUntil: null,
            lastUsed: null,
            addedAt: new Date(),
        });
    }

    /**
     * Mask an API key for display (security)
     * @private
     * @param {string} key - The full API key
     * @returns {string} Masked key showing only first 8 characters
     */
    _maskKey(key) {
        if (!key || key.length < 8) return '***';
        return key.substring(0, 8) + '***';
    }

    /**
     * Check if a key is currently available (not in cooldown, not revoked)
     * @private
     * @param {string} key - The API key to check
     * @returns {boolean} True if the key is available for use
     */
    _isKeyAvailable(key) {
        const stat = this.stats.get(key);
        if (!stat) return false;

        // Check if revoked
        if (stat.isRevoked) return false;

        // Check if in cooldown
        if (stat.cooldownUntil) {
            if (Date.now() < stat.cooldownUntil) {
                return false;
            } else {
                // Cooldown expired, reset it
                stat.cooldownUntil = null;
                stat.isActive = true;
            }
        }

        return stat.isActive;
    }

    /**
     * Internal method to select next available key
     * @private
     * @returns {string|null} The next available API key
     */
    _selectNextAvailableKey() {
        if (!this.initialized || this.keys.length === 0) {
            return null;
        }

        const startIndex = this.currentIndex;
        let attempts = 0;

        while (attempts < this.keys.length) {
            const key = this.keys[this.currentIndex];
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;

            if (this._isKeyAvailable(key)) {
                const stat = this.stats.get(key);
                stat.lastUsed = new Date();
                return key;
            }
            attempts++;
        }
        return null;
    }

    /**
     * Get the current API key (pre-selected at startup)
     * @returns {string|null} The current API key, or null if none available
     */
    getNextKey() {
        if (!this.initialized || this.keys.length === 0) {
            console.error('[ElevenLabsKeyPool] Pool not initialized or empty');
            return null;
        }

        // If we have a valid current key, use it
        if (this.currentKey && this._isKeyAvailable(this.currentKey)) {
            return this.currentKey;
        }

        // Otherwise, select a new key
        this.currentKey = this._selectNextAvailableKey();

        if (this.currentKey) {
            return this.currentKey;
        }

        // No keys available - check if any are just in cooldown
        const cooldownKeys = this.keys.filter(key => {
            const stat = this.stats.get(key);
            return stat && !stat.isRevoked && stat.cooldownUntil;
        });

        if (cooldownKeys.length > 0) {
            const soonestKey = cooldownKeys.reduce((a, b) => {
                const statA = this.stats.get(a);
                const statB = this.stats.get(b);
                return statA.cooldownUntil < statB.cooldownUntil ? a : b;
            });

            const stat = this.stats.get(soonestKey);
            const waitTime = Math.ceil((stat.cooldownUntil - Date.now()) / 1000);
            console.warn(`[ElevenLabsKeyPool] All keys in cooldown. Soonest available in ${waitTime}s`);
        } else {
            console.error('[ElevenLabsKeyPool] All keys are either revoked or unavailable');
        }

        return null;
    }

    /**
     * Report a successful API request for a key
     * @param {string} key - The API key that was used
     */
    reportSuccess(key) {
        const stat = this.stats.get(key);
        if (stat) {
            stat.successCount++;
            stat.isActive = true;
            stat.cooldownUntil = null; // Clear any cooldown on success
        }
    }

    /**
     * Report an error for a key and handle rate limits/invalid keys
     * @param {string} key - The API key that encountered an error
     * @param {Error|Object} error - The error object from the API
     * @returns {Object} Object containing error type and whether key was handled
     */
    reportError(key, error) {
        const stat = this.stats.get(key);
        if (!stat) {
            return { type: 'unknown', keyHandled: false };
        }

        stat.errorCount++;

        // Extract error code/status
        const errorCode = error?.status || error?.code || 0;
        const errorMessage = error?.message || '';

        // Check for rate limit errors
        const isRateLimited = RATE_LIMIT_ERRORS.some(code =>
            errorCode === code || errorMessage.includes(String(code)) ||
            errorMessage.toLowerCase().includes('rate limit') ||
            errorMessage.toLowerCase().includes('quota')
        );

        if (isRateLimited) {
            stat.rateLimitHits++;
            stat.isActive = false;
            stat.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;

            // Auto-switch to next available key
            this.currentKey = this._selectNextAvailableKey();

            return {
                type: 'rate_limit',
                keyHandled: true,
                cooldownEnds: new Date(stat.cooldownUntil),
                message: 'Key placed in 60-second cooldown',
                newKey: this.currentKey
            };
        }

        // Check for invalid/revoked key errors
        const isInvalidKey = INVALID_KEY_ERRORS.some(code =>
            errorCode === code || errorMessage.includes(String(code)) ||
            errorMessage.toLowerCase().includes('invalid') ||
            errorMessage.toLowerCase().includes('unauthorized')
        );

        if (isInvalidKey) {
            stat.isRevoked = true;
            stat.isActive = false;

            // Auto-switch to next available key
            this.currentKey = this._selectNextAvailableKey();

            return {
                type: 'invalid_key',
                keyHandled: true,
                message: 'Key permanently removed from pool',
                newKey: this.currentKey
            };
        }

        return {
            type: 'other',
            keyHandled: false,
            message: errorMessage
        };
    }

    /**
     * Get comprehensive statistics for the key pool
     * @returns {Object} Statistics object with all pool and key-level stats
     */
    getStats() {
        const keyStats = [];
        let totalSuccesses = 0;
        let totalErrors = 0;
        let activeKeys = 0;
        let coolingDownKeys = 0;
        let revokedKeys = 0;

        for (const [key, stat] of this.stats.entries()) {
            totalSuccesses += stat.successCount;
            totalErrors += stat.errorCount;

            if (stat.isRevoked) {
                revokedKeys++;
            } else if (stat.cooldownUntil && Date.now() < stat.cooldownUntil) {
                coolingDownKeys++;
            } else if (stat.isActive) {
                activeKeys++;
            }

            keyStats.push({
                key: this._maskKey(key),
                successCount: stat.successCount,
                errorCount: stat.errorCount,
                rateLimitHits: stat.rateLimitHits,
                isActive: this._isKeyAvailable(key),
                isRevoked: stat.isRevoked,
                cooldownUntil: stat.cooldownUntil,
                cooldownRemaining: stat.cooldownUntil
                    ? Math.max(0, Math.ceil((stat.cooldownUntil - Date.now()) / 1000))
                    : null,
                lastUsed: stat.lastUsed,
                addedAt: stat.addedAt,
            });
        }

        return {
            totalKeys: this.keys.length,
            activeKeys,
            coolingDownKeys,
            revokedKeys,
            totalRequests: totalSuccesses + totalErrors,
            totalSuccesses,
            totalErrors,
            successRate: totalSuccesses + totalErrors > 0
                ? ((totalSuccesses / (totalSuccesses + totalErrors)) * 100).toFixed(1) + '%'
                : 'N/A',
            isHealthy: activeKeys > 0,
            keys: keyStats,
        };
    }

    /**
     * Force refresh of all keys (re-read from .env)
     * @returns {boolean} True if refresh was successful
     */
    refresh() {
        console.log('[ElevenLabsKeyPool] Refreshing key pool...');
        return this.initialize();
    }

    /**
     * Get the count of currently available keys
     * @returns {number} Number of keys that can be used right now
     */
    getAvailableKeyCount() {
        return this.keys.filter(key => this._isKeyAvailable(key)).length;
    }

    /**
     * Check if the pool is healthy (has at least one usable key)
     * @returns {boolean} True if at least one key is available
     */
    isHealthy() {
        return this.getAvailableKeyCount() > 0;
    }

    /**
     * Validate a single API key by making a test request
     * @private
     * @param {string} key - The API key to validate
     * @returns {Promise<boolean>} True if key is valid
     */
    async _validateKey(key) {
        try {
            const response = await fetch('https://api.elevenlabs.io/v1/user', {
                headers: { 'xi-api-key': key }
            });

            if (!response.ok) {
                if (response.status === 401 || response.status === 403) {
                    const stat = this.stats.get(key);
                    if (stat) {
                        stat.isRevoked = true;
                        stat.isActive = false;
                    }
                }
                return false;
            }
            return true;
        } catch (error) {
            console.error(`[ElevenLabsKeyPool] Validation failed for ${this._maskKey(key)}:`, error.message);
            return false;
        }
    }

    /**
     * Validate all keys in the pool at startup
     * @returns {Promise<Object>} Validation results with valid and invalid keys
     */
    async validateAllKeys() {
        if (!this.initialized || this.keys.length === 0) {
            return { validCount: 0, invalidCount: 0, validated: false };
        }

        console.log(`[ElevenLabsKeyPool] Validating ${this.keys.length} API key(s)...`);

        const validationPromises = this.keys.map(async (key) => {
            const isValid = await this._validateKey(key);
            return { key, isValid };
        });

        const results = await Promise.all(validationPromises);

        const validKeys = results.filter(r => r.isValid);
        const invalidKeys = results.filter(r => !r.isValid);

        // Remove invalid keys from the pool ? 
        // For now we just mark them revoked in _validateKey

        console.log(`[ElevenLabsKeyPool] Validation complete: ${validKeys.length} valid, ${invalidKeys.length} invalid`);

        if (validKeys.length > 0) {
            this.currentKey = validKeys[0].key;
        }

        return {
            validCount: validKeys.length,
            invalidCount: invalidKeys.length,
            validated: true
        };
    }
}

// Singleton instance
const elevenLabsKeyPool = new ElevenLabsKeyPool();

module.exports = {
    // Main API methods
    initialize: () => elevenLabsKeyPool.initialize(),
    getNextKey: () => elevenLabsKeyPool.getNextKey(),
    reportSuccess: (key) => elevenLabsKeyPool.reportSuccess(key),
    reportError: (key, error) => elevenLabsKeyPool.reportError(key, error),
    getStats: () => elevenLabsKeyPool.getStats(),

    // Additional utility methods
    refresh: () => elevenLabsKeyPool.refresh(),
    isHealthy: () => elevenLabsKeyPool.isHealthy(),
    getAvailableKeyCount: () => elevenLabsKeyPool.getAvailableKeyCount(),
    validateAllKeys: () => elevenLabsKeyPool.validateAllKeys(),
};
