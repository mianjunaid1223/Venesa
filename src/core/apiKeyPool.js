/**
 * Gemini API Key Pool Manager
 * 
 * Features:
 * - Round-robin key rotation between multiple keys
 * - Automatic failover when a key hits rate limits
 * - 60-second cooldown for rate-limited keys
 * - Automatic removal of invalid/revoked keys
 * - Usage statistics tracking per key
 * 
 * Color Scheme Reference (Blob Identity):
 * - Primary: #8B5CF6 (Vibrant Purple)
 * - Secondary: #06B6D4 (Electric Cyan)
 * - Tertiary: #EC4899 (Hot Pink)
 * - Accent: #A855F7 (Bright Violet)
 */

const fs = require('fs');
const path = require('path');

// Constants
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // 60 seconds cooldown
const INVALID_KEY_ERRORS = [401, 403, 'API_KEY_INVALID', 'PERMISSION_DENIED'];
const RATE_LIMIT_ERRORS = [429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED'];

/**
 * @typedef {Object} KeyStats
 * @property {string} key - Masked API key (first 8 chars + ***)
 * @property {number} successCount - Number of successful requests
 * @property {number} errorCount - Number of failed requests
 * @property {number} rateLimitHits - Number of rate limit errors
 * @property {boolean} isActive - Whether the key is currently usable
 * @property {boolean} isRevoked - Whether the key has been permanently removed
 * @property {number|null} cooldownUntil - Timestamp when cooldown ends
 * @property {Date} lastUsed - Last time this key was used
 */

/**
 * @typedef {Object} PoolStats
 * @property {number} totalKeys - Total number of keys in the pool
 * @property {number} activeKeys - Number of currently usable keys
 * @property {number} coolingDownKeys - Number of keys in cooldown
 * @property {number} revokedKeys - Number of permanently removed keys
 * @property {number} totalRequests - Total requests across all keys
 * @property {number} totalSuccesses - Total successful requests
 * @property {number} totalErrors - Total failed requests
 * @property {KeyStats[]} keys - Stats for each key
 */

class APIKeyPool {
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
            console.warn('[APIKeyPool] No .env file found at:', envPath);
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

                // Match GEMINI_API_KEY or GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
                const match = trimmedLine.match(/^GEMINI_API_KEY(?:_\d+)?=(.+)$/);

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
            console.error('[APIKeyPool] Error reading .env file:', error.message);
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
            console.warn('[APIKeyPool] Duplicate key ignored');
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
            console.error('[APIKeyPool] Pool not initialized or empty');
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
            console.warn(`[APIKeyPool] All keys in cooldown. Soonest available in ${waitTime}s`);
        } else {
            console.error('[APIKeyPool] All keys are either revoked or unavailable');
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
        const errorCode = error?.status || error?.code || error?.error?.code;
        const errorMessage = error?.message || error?.error?.message || '';

        // Check for rate limit errors - prioritize explicit codes, then use strict regex
        const isRateLimited = RATE_LIMIT_ERRORS.some(code => errorCode === code) ||
            /\brate\s*limit\b|\bquota\s*exceeded\b|\bresource\s*exhausted\b/i.test(errorMessage);

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

        // Check for invalid/revoked key errors - mutually exclusive from rate limit
        // Prioritize explicit codes, then use strict regex patterns
        const isInvalidKey = INVALID_KEY_ERRORS.some(code => errorCode === code) ||
            /\binvalid\s*key\b|\bpermission\s*denied\b|\bunauthorized\b|\bapi_key_invalid\b/i.test(errorMessage);

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

        // Other errors - don't modify key status

        return {
            type: 'other',
            keyHandled: false,
            message: errorMessage
        };
    }

    /**
     * Get comprehensive statistics for the key pool
     * @returns {PoolStats} Statistics object with all pool and key-level stats
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
        console.log('[APIKeyPool] Refreshing key pool...');
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
            // Make a minimal request to test the key
            const { GoogleGenerativeAI } = require('@google/generative-ai');
            const genAI = new GoogleGenerativeAI(key);
            const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

            // Simple test query
            const result = await model.generateContent('Hi');
            await result.response;

            return true;
        } catch (error) {
            console.error(`[APIKeyPool] Validation failed for ${this._maskKey(key)}:`, error.message);

            // Mark as invalid if it's a key-related error
            const errorCode = error?.status || error?.code;
            const errorMessage = error?.message || '';

            const isInvalidKey = INVALID_KEY_ERRORS.some(code =>
                errorCode === code || errorMessage.includes(String(code)) ||
                errorMessage.toLowerCase().includes('invalid') ||
                errorMessage.toLowerCase().includes('permission') ||
                errorMessage.toLowerCase().includes('unauthorized')
            );

            if (isInvalidKey) {
                const stat = this.stats.get(key);
                if (stat) {
                    stat.isRevoked = true;
                    stat.isActive = false;
                }
            }

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

        console.log(`[APIKeyPool] Validating ${this.keys.length} API key(s)...`);

        // Sequential validation to avoid rate limits
        const results = [];
        for (const key of this.keys) {
            const isValid = await this._validateKey(key);
            results.push({ key, isValid });
            // Small delay between validations to avoid rate limits
            if (this.keys.indexOf(key) < this.keys.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        const validKeys = results.filter(r => r.isValid);
        const invalidKeys = results.filter(r => !r.isValid);

        // Remove invalid keys from the pool
        invalidKeys.forEach(({ key }) => {
            const index = this.keys.indexOf(key);
            if (index > -1) {
                this.keys.splice(index, 1);
            }
        });

        console.log(`[APIKeyPool] Validation complete: ${validKeys.length} valid, ${invalidKeys.length} invalid`);

        // Update current key if needed
        if (validKeys.length > 0) {
            this.currentKey = validKeys[0].key;
            console.log(`[APIKeyPool] Pre-selected key: ${this._maskKey(this.currentKey)}`);
        } else {
            this.currentKey = null;
        }

        return {
            validCount: validKeys.length,
            invalidCount: invalidKeys.length,
            validated: true
        };
    }

    /**
     * Manually add a key at runtime (not from .env)
     * @param {string} key - The API key to add
     * @returns {boolean} True if key was added successfully
     */
    addKey(key) {
        if (!key || typeof key !== 'string' || key.length < 10) {
            console.error('[APIKeyPool] Invalid key provided');
            return false;
        }

        this._addKey(key);
        this.initialized = true;
        console.log(`[APIKeyPool] Key ${this._maskKey(key)} added manually`);
        return true;
    }

    /**
     * Remove a key from the pool
     * @param {string} key - The API key to remove
     * @returns {boolean} True if key was removed
     */
    removeKey(key) {
        const index = this.keys.indexOf(key);
        if (index === -1) return false;

        this.keys.splice(index, 1);
        this.stats.delete(key);

        // Clear currentKey if it was the removed key
        if (this.currentKey === key) {
            this.currentKey = null;
        }

        // Adjust current index if needed
        if (this.currentIndex >= this.keys.length) {
            this.currentIndex = 0;
        } else if (index < this.currentIndex) {
            // Shift index down if removed key was before current
            this.currentIndex = Math.max(0, this.currentIndex - 1);
        }

        console.log(`[APIKeyPool] Key ${this._maskKey(key)} removed from pool`);
        return true;
    }
}

// Singleton instance
const keyPool = new APIKeyPool();

module.exports = {
    // Main API methods
    initialize: () => keyPool.initialize(),
    getNextKey: () => keyPool.getNextKey(),
    reportSuccess: (key) => keyPool.reportSuccess(key),
    reportError: (key, error) => keyPool.reportError(key, error),
    getStats: () => keyPool.getStats(),

    // Additional utility methods
    refresh: () => keyPool.refresh(),
    isHealthy: () => keyPool.isHealthy(),
    getAvailableKeyCount: () => keyPool.getAvailableKeyCount(),
    addKey: (key) => keyPool.addKey(key),
    removeKey: (key) => keyPool.removeKey(key),
    validateAllKeys: () => keyPool.validateAllKeys(),

    // Export class for testing/custom instances
    APIKeyPool,
};
