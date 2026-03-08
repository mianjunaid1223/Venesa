// Paths — resolves file-system paths for models, assets, logs, and user data.
const path = require('path');
const { app } = require('electron');

function isPackaged() {
    return app.isPackaged;
}

function getBasePath() {
    if (isPackaged()) {
        return process.resourcesPath;
    }
    return path.join(__dirname, '../..');
}

function getResourcesPath() {
    return getBasePath();
}

function getModelsPath() {
    return path.join(getResourcesPath(), 'models');
}

function getVoskModelPath(modelName = 'vosk-model-small-en-us-0.15') {
    return path.join(getModelsPath(), modelName);
}

function getVoskModelTarGzPath() {
    return path.join(getModelsPath(), 'vosk-model.tar.gz');
}

function getAssetsPath() {
    return path.join(getResourcesPath(), 'assets');
}

function getEnvPath() {
    return path.join(getResourcesPath(), '.env');
}

let cachedLogsPath = null;

function getLogsPath() {
    if (cachedLogsPath) return cachedLogsPath;

    if (isPackaged() && !app.isReady()) {
        const os = require('os');
        return path.join(os.tmpdir(), 'venesa-logs-startup');
    }

    if (isPackaged()) {
        cachedLogsPath = path.join(app.getPath('userData'), 'logs');
        return cachedLogsPath;
    }

    cachedLogsPath = path.join(getBasePath(), 'logs');
    return cachedLogsPath;
}

if (app && !app.isReady()) {
    app.once('ready', () => {
        cachedLogsPath = null;
    });
}

/**
 * ~/.venesa/
 * Root of all user-scoped persistent data.
 */
function getVenesaDir() {
    const os = require('os');
    return path.join(os.homedir(), '.venesa');
}

/**
 * ~/.venesa/settings.json
 */
function getSettingsPath() {
    return path.join(getVenesaDir(), 'settings.json');
}

/**
 * ~/.venesa/memory/
 */
function getMemoryPath() {
    return path.join(getVenesaDir(), 'memory');
}

/**
 * ~/.venesa/capabilities/
 * Stores user-installed community capabilities (one .js file per capability).
 */
function getCapabilitiesPath() {
    return path.join(getVenesaDir(), 'capabilities');
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
    getLogsPath,
    getVenesaDir,
    getSettingsPath,
    getMemoryPath,
    getCapabilitiesPath,
};
