

const levels = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
};

const currentLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';

function shouldLog(level) {
    return levels[level] <= levels[currentLevel];
}

function formatMessage(level, message) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    return `${timestamp} ${level}: ${message}`;
}

const logger = {
    error: (message, ...args) => {
        if (shouldLog('error')) {
            console.error(formatMessage('error', message), ...args);
        }
    },
    warn: (message, ...args) => {
        if (shouldLog('warn')) {
            console.warn(formatMessage('warn', message), ...args);
        }
    },
    info: (message, ...args) => {
        if (shouldLog('info')) {
            console.log(formatMessage('info', message), ...args);
        }
    },
    debug: (message, ...args) => {
        if (shouldLog('debug')) {
            console.log(formatMessage('debug', message), ...args);
        }
    }
};

module.exports = logger;
