/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Model Server
 *  Serves Vosk model files to the renderer over localhost HTTP.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: (none)
 *  USED BY:    platform/main
 * ═══════════════════════════════════════════════════════════════
 */

const http = require('http');
const fs = require('fs');

let modelServer = null;
let modelServerPort = 0;

function startModelServer(modelTarGzPath) {
    return new Promise((resolve, reject) => {
        modelServer = http.createServer((req, res) => {
            fs.readFile(modelTarGzPath, (err, data) => {
                if (err) {
                    res.writeHead(404);
                    res.end('Not found');
                    return;
                }
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/gzip');
                res.setHeader('Content-Length', data.length);
                res.writeHead(200);
                res.end(data);
            });
        });

        const onError = (err) => {
            modelServer.removeListener('error', onError);
            reject(err);
        };
        modelServer.on('error', onError);

        modelServer.listen(0, '127.0.0.1', () => {
            modelServer.removeListener('error', onError);
            modelServerPort = modelServer.address().port;
            resolve(modelServerPort);
        });
    });
}

let startingPromise = null;

async function ensureRunning(modelTarGzPath) {
    if (modelServer) return modelServerPort;
    if (startingPromise) return startingPromise;

    startingPromise = startModelServer(modelTarGzPath)
        .then(port => { startingPromise = null; return port; })
        .catch(err => { startingPromise = null; throw err; });

    return startingPromise;
}

function getPort() {
    return modelServerPort;
}

module.exports = {
    startModelServer,
    ensureRunning,
    getPort,
};
