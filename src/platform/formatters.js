/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Formatters
 *  Parse action results into human-readable text/voice output.
 * ═══════════════════════════════════════════════════════════════
 *  DEPENDS ON: (none)
 *  USED BY:    platform/ipc/query-handlers, platform/ipc/voice-handlers
 * ═══════════════════════════════════════════════════════════════
 */

function parseResult(res) {
    if (!res || !res.result) return null;
    try {
        return typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
    } catch (e) {
        return res.result;
    }
}

const extractors = {
    getSystemInfo: (data) => {
        if (data && !data.error) {
            const ramUsedFallback = data.ramUsed ?? "unknown";
            const ramTotalFallback = data.ramTotal ?? "unknown";
            return { cpu: data.cpu, ram: `${ramUsedFallback}/${ramTotalFallback}GB`, battery: data.battery, uptime: data.uptime };
        }
        return null;
    },
    getTime: (data) => data?.full ? { time: data.full } : null,
    calculate: (data) => {
        if (data?.result) return { answer: data.result };
        if (data?.error) return { error: data.error };
        return null;
    },
    listRunningApps: (data) => {
        const apps = Array.isArray(data) ? data : [];
        return { apps, count: apps.length, names: apps.map(a => a.name).join(', ') };
    },
    closeApp: (data) => {
        if (data?.success && data?.closed) {
            const names = Array.isArray(data.closed) ? data.closed.join(', ') : data.closed;
            return { closed: names };
        }
        return data?.error ? { error: data.error } : null;
    },
    closeAllApps: (data) => data?.success ? { count: data.count || 0 } : null,
    getClipboard: (data) => {
        const content = data == null ? '' : (typeof data === 'string' ? data : String(data));
        const snippet = content.length > 30 ? content.substring(0, 30) + '...' : content;
        return { snippet, length: content.length };
    },
    setClipboard: () => ({ done: true }),
    takeScreenshot: (data) => data?.success ? { done: true } : null,
    getNetworkInfo: (data) => {
        if (data?.ip && Array.isArray(data.ip)) {
            return { interfaces: data.ip.map(i => `${i.InterfaceAlias}: ${i.IPAddress}`).join(', ') };
        }
        return null;
    },
    getDiskInfo: (data) => {
        const arr = Array.isArray(data) ? data : [data];
        return { disks: arr.filter(d => d).map(d => `${d.DeviceID || '<unknown>'} ${d.FreeGB != null ? d.FreeGB : '<n/a>'}/${d.SizeGB != null ? d.SizeGB : '<n/a>'}GB free`).join(', ') };
    },
    listProcesses: (data) => {
        if (Array.isArray(data)) {
            return { top: data.slice(0, 5).map(p => p.ProcessName).join(', ') };
        }
        return null;
    },
    runPowerShell: (data) => {
        if (data instanceof Error || (data && typeof data === 'object' && data.error)) return null;
        let result;
        if (typeof data === 'string') {
            result = data;
        } else {
            try {
                result = JSON.stringify(data);
            } catch (e) {
                const util = require('util');
                result = util.inspect(data);
            }
        }
        return { output: result };
    },
};

function extract(res) {
    if (!res || !res.result) return null;
    if (res.skipped) return null;
    const extractor = extractors[res.actionName];
    if (!extractor) return null;
    const data = parseResult(res);
    if (data === null) return null;
    return extractor(data);
}

function formatForText(res) {
    const info = extract(res);
    if (!info) return null;
    switch (res.actionName) {
        case 'calculate': return info.answer ? `= ${info.answer}` : null;
        case 'getSystemInfo': return `CPU: ${info.cpu}, RAM: ${info.ram}, Battery: ${info.battery}`;
        case 'getTime': return info.time;
        case 'getDiskInfo': return info.disks;
        case 'getNetworkInfo': return info.interfaces;
        case 'listProcesses': return info.top;
        default: return null;
    }
}

function formatForVoice(res) {
    const info = extract(res);
    if (!info) return null;
    switch (res.actionName) {
        case 'getSystemInfo': return `CPU is at ${info.cpu}, RAM is ${info.ram}, battery at ${info.battery}, uptime ${info.uptime}.`;
        case 'getTime': return `It's ${info.time}.`;
        case 'calculate':
            if (info.answer) return `The answer is ${info.answer}.`;
            if (info.error) return `Couldn't compute that.`;
            return null;
        case 'listRunningApps':
            if (info.count > 0) return `You have ${info.count} app${info.count > 1 ? 's' : ''} open: ${info.names}.`;
            return 'No visible apps running.';
        case 'closeApp': return info.closed ? `Closed ${info.closed}.` : info.error || null;
        case 'closeAllApps': return `Closed ${info.count} app${info.count !== 1 ? 's' : ''}.`;
        case 'getClipboard': return `Clipboard: ${info.snippet}`;
        case 'setClipboard': return 'Copied to clipboard.';
        case 'takeScreenshot': return 'Screenshot saved.';
        case 'getNetworkInfo': return `Network: ${info.interfaces}`;
        case 'getDiskInfo': return `Storage: ${info.disks}`;
        case 'listProcesses':
            const isPlural = info.top && info.top.includes(',');
            return `${info.top} ${isPlural ? 'are' : 'is'} using the most CPU.`;
        case 'runPowerShell': return info.output;
        default: return null;
    }
}

const DISPLAY_ONLY_ACTIONS = new Set([
    'listCommands', 'searchFiles', 'getInstalledApps', 'listRunningApps',
    'getSystemInfo', 'getNetworkInfo', 'getDiskInfo', 'listProcesses',
]);

const SILENT_ACTIONS = new Set([
    'googleSearch', 'youtubeSearch', 'getWeather', 'setReminder',
]);

module.exports = { formatForText, formatForVoice, DISPLAY_ONLY_ACTIONS, SILENT_ACTIONS };
