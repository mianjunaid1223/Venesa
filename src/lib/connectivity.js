"use strict";
// Connectivity — polls network reachability every 5s using Electron's net API.
const { net } = require('electron');
const logger = require('./logger');

const POLL_INTERVAL_MS = 5000;
const REQUEST_TIMEOUT_MS = 4000;
const PROBE_URL = 'https://www.google.com';

let _online = null; // null = unknown until first probe; false = offline; true = online
let _monitorInterval = null;
const _listeners = [];


async function checkNow() {
    try {
        return await new Promise((resolve) => {
            let settled = false;

            const req = net.request({ method: 'HEAD', url: PROBE_URL });

            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                try { req.abort(); } catch { /* ignore */ }
                resolve(false);
            }, REQUEST_TIMEOUT_MS);

            req.on('response', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(true);
            });

            req.on('error', () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(false);
            });

            req.end();
        });
    } catch (e) {
        logger.warn(`[net-guard] checkNow error: ${e.message}`);
        return false;
    }
}

async function _poll() {
    try {
        const result = await checkNow();
        if (result !== _online) {
            _online = result;
            logger.info(`[net-guard] Status changed → ${_online ? 'online' : 'offline'}`);
            const listeners = _listeners.slice();
            for (const fn of listeners) {
                try { fn(_online); } catch (e) {
                    logger.warn(`[net-guard] onChange listener error: ${e.message}`);
                }
            }
        }
    } catch (e) {
        logger.warn(`[net-guard] poll error: ${e.message}`);
    }
}


function isOnline() {
    return _online;
}

function onChange(fn) {
    if (typeof fn !== 'function') return () => {};
    _listeners.push(fn);
    let removed = false;
    return function unsubscribe() {
        if (removed) return;
        removed = true;
        const idx = _listeners.indexOf(fn);
        if (idx !== -1) _listeners.splice(idx, 1);
    };
}

function startMonitoring() {
    try {
        if (_monitorInterval) return;
        _poll();                                        // immediate check
        _monitorInterval = setInterval(_poll, POLL_INTERVAL_MS);
        logger.info('[net-guard] Connectivity monitoring started');
    } catch (e) {
        logger.error(`[net-guard] startMonitoring error: ${e.message}`);
    }
}

module.exports = { isOnline, checkNow, onChange, startMonitoring };
