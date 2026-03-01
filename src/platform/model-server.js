const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

// Use a fixed port so the model URL is stable across restarts.
// A stable URL lets Chromium's HTTP disk cache persist the 40 MB
// model tar.gz — turning a 20-40s WASM load into a ~1-2s cache hit.
const FIXED_PORT = 47391;

let modelServer = null;
let modelServerPort = 0;
let modelEtag = null;
let modelTarGzPath_ = null;

// Probes whether an existing HTTP listener on `port` is already serving the
// model tar.gz.  Returns the port if healthy, null otherwise.
function probeExistingServer(port) {
    return new Promise((resolve) => {
        const req = http.get(
            { host: '127.0.0.1', port, path: '/model.tar.gz', timeout: 1500 },
            (res) => {
                res.destroy();
                resolve(res.statusCode === 200 || res.statusCode === 304 ? port : null);
            }
        );
        req.on('timeout', () => { req.destroy(); resolve(null); });
        req.on('error', () => resolve(null));
    });
}

function buildHandler() {
    return (req, res) => {
        try {
            const stat = fs.statSync(modelTarGzPath_);

            if (modelEtag && req.headers['if-none-match'] === modelEtag) {
                res.writeHead(304);
                res.end();
                return;
            }

            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Content-Type', 'application/gzip');
            res.setHeader('Content-Length', stat.size);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            if (modelEtag) res.setHeader('ETag', modelEtag);
            res.writeHead(200);

            const stream = fs.createReadStream(modelTarGzPath_);
            stream.pipe(res);
            stream.on('error', (err) => {
                console.error(`[ModelServer] Stream error: ${err.message}`);
                if (!res.headersSent) res.writeHead(500);
                res.end();
            });
        } catch (err) {
            res.writeHead(404);
            res.end('Not found');
        }
    };
}

function startModelServer(modelTarGzPath) {
    modelTarGzPath_ = modelTarGzPath;

    // Compute a stable ETag from the file's mtime+size so that if the model
    // file changes the cache is automatically invalidated.
    try {
        const stat = fs.statSync(modelTarGzPath);
        modelEtag = '"' + crypto.createHash('md5')
            .update(String(stat.mtimeMs) + String(stat.size))
            .digest('hex') + '"';
    } catch (_) {
        modelEtag = null;
    }

    return new Promise((resolve, reject) => {
        modelServer = http.createServer(buildHandler());

        const onError = async (err) => {
            modelServer.removeListener('error', onError);

            if (err.code === 'EADDRINUSE') {
                // Port is in use — likely a stale server from the previous
                // process instance.  Probe it first so we can reuse the
                // stable URL (and therefore the Chromium disk-cache entry)
                // rather than falling back to a random port and busting the
                // cache every restart.
                console.warn(`[ModelServer] Port ${FIXED_PORT} in use — probing existing server...`);
                const existingPort = await probeExistingServer(FIXED_PORT);
                if (existingPort) {
                    console.log(`[ModelServer] Existing server healthy on ${FIXED_PORT} — reusing`);
                    modelServer = null; // we don't own this server
                    modelServerPort = FIXED_PORT;
                    resolve(FIXED_PORT);
                    return;
                }

                // Port held but not responding — give the OS 1 s to release it
                // then retry; fall back to a random port only as a last resort.
                console.warn('[ModelServer] Existing server unresponsive, waiting 1s then retrying...');
                await new Promise(r => setTimeout(r, 1000));

                const retryServer = http.createServer(buildHandler());
                retryServer.listen(FIXED_PORT, '127.0.0.1', () => {
                    modelServer = retryServer;
                    modelServerPort = FIXED_PORT;
                    resolve(FIXED_PORT);
                });
                retryServer.once('error', () => {
                    // Still busy — last resort: random port
                    console.warn('[ModelServer] Still busy, falling back to random port (cache will miss this run)');
                    const fallbackServer = http.createServer(buildHandler());
                    fallbackServer.once('error', (fallbackErr) => {
                        console.error(`[ModelServer] Fallback random-port listen failed: ${fallbackErr.message}`);
                        reject(fallbackErr);
                    });
                    fallbackServer.listen(0, '127.0.0.1', () => {
                        modelServer = fallbackServer;
                        modelServerPort = fallbackServer.address().port;
                        resolve(modelServerPort);
                    });
                });
                return;
            }
            reject(err);
        };

        modelServer.on('error', onError);

        // Try fixed port first for cache-friendly stable URL
        modelServer.listen(FIXED_PORT, '127.0.0.1', () => {
            modelServer.removeListener('error', onError);
            modelServerPort = FIXED_PORT;
            resolve(FIXED_PORT);
        });
    });
}

let startingPromise = null;

async function ensureRunning(modelTarGzPath) {
    if (modelServer || modelServerPort) return modelServerPort;
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
