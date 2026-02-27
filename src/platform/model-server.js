/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Model Server
 *  Serves Vosk model files to the renderer over localhost HTTP.
 *  Uses streaming to avoid memory buffering large model files.
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
            // Stream the model file instead of buffering the entire file in memory
            try {
                const stat = fs.statSync(modelTarGzPath);
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Content-Type', 'application/gzip');
                res.setHeader('Content-Length', stat.size);
                res.writeHead(200);

                const stream = fs.createReadStream(modelTarGzPath);
                stream.pipe(res);
                stream.on('error', (err) => {
                    console.error(`[ModelServer] Stream error: ${err.message}`);
                    if (!res.headersSent) {
                        res.writeHead(500);
                    }
                    res.end();
                });
            } catch (err) {
                res.writeHead(404);
                res.end('Not found');
            }
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
