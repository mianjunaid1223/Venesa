

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

    if (isPackaged()) {
        if (app.isReady()) {
            cachedLogsPath = path.join(app.getPath('userData'), 'logs');
            return cachedLogsPath;
        }

        cachedLogsPath = path.join(getBasePath(), 'logs');
        return cachedLogsPath;
    }

    cachedLogsPath = path.join(getBasePath(), 'logs');
    return cachedLogsPath;
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
