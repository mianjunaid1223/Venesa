const winston = require('winston');
const path = require('path');
const fs = require('fs');
const os = require('os');

const logsDir = process.env.LOG_DIR || path.join(path.dirname(__dirname), '..', 'logs');
try {
    fs.mkdirSync(logsDir, { recursive: true });
} catch (error) {
    console.error(`[Logger] Failed to create logs directory '${logsDir}': ${error.message}`);
    process.exit(1);
}

// Define log format
const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
        return `${timestamp} ${level}: ${stack || message}`;
    })
);

// Create logger instance
const logger = winston.createLogger({
    level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
    format: logFormat,
    transports: [
        // Console output
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                logFormat
            )
        }),
        // File output with rotation
        new winston.transports.File({
            filename: path.join(logsDir, 'error.log'),
            level: 'error',
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(logsDir, 'combined.log'),
            maxsize: 5 * 1024 * 1024, // 5MB
            maxFiles: 5
        })
    ],
    exitOnError: false
});

// Add metadata for debugging
logger.defaultMeta = {
    service: 'venesa',
    version: require('../../package.json').version,
    platform: os.platform(),
    arch: os.arch()
};

module.exports = logger;