/**
 * Path utilities for Venesa - handles production vs development path resolution
 * 
 * In production (packaged app):
 *   - app.asar contains src/ files
 *   - process.resourcesPath points to resources/ folder
 *   - extraResources (models/, assets/, .env) are in resources/
 * 
 * In development:
 *   - __dirname works relative to src/ structure
 *   - models/, assets/, .env are in project root
 */

const path = require('path');
const { app } = require('electron');

/**
 * Check if we're running in a packaged production build
 */
function isPackaged() {
    return app.isPackaged;
}

/**
 * Get the base path for the app (project root in dev, resources root in prod)
 */
function getBasePath() {
    if (isPackaged()) {
        // In production, go up from resources/app.asar to resources/
        return process.resourcesPath;
    }
    // In development, go up from src/core to project root
    return path.join(__dirname, '../..');
}

/**
 * Get path to extraResources folder (assets, models, .env)
 * In production: resources/
 * In development: project root
 */
function getResourcesPath() {
    return getBasePath();
}

/**
 * Get path to the models directory
 */
function getModelsPath() {
    return path.join(getResourcesPath(), 'models');
}

/**
 * Get path to a specific Vosk model
 */
function getVoskModelPath(modelName = 'vosk-model-small-en-us-0.15') {
    return path.join(getModelsPath(), modelName);
}

/**
 * Get path to the Vosk model tar.gz file
 */
function getVoskModelTarGzPath() {
    return path.join(getModelsPath(), 'vosk-model.tar.gz');
}

/**
 * Get path to assets directory
 */
function getAssetsPath() {
    return path.join(getResourcesPath(), 'assets');
}

/**
 * Get path to the .env file
 */
function getEnvPath() {
    return path.join(getResourcesPath(), '.env');
}

/**
 * Get path to logs directory
 * Logs should be written to user data directory in production
 */
function getLogsPath() {
    if (isPackaged()) {
        return path.join(app.getPath('userData'), 'logs');
    }
    return path.join(getBasePath(), 'logs');
}

module.exports = {
    isPackaged,
    getBasePath,
    getResourcesPath,
    getModelsPath,
    getVoskModelPath,
    getVoskModelTarGzPath,
    getAssetsPath,
    getEnvPath,
    getLogsPath
};
