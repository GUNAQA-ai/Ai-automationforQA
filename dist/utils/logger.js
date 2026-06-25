"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
/**
 * Centralised logger used across the framework.
 * Supports console and file transports, with optional JSON formatting.
 * The log level is driven by the LOG_LEVEL env variable (default: 'info').
 * Secrets are masked using the maskSecrets helper.
 */
class Logger {
    constructor() {
        const logLevel = process.env.LOG_LEVEL || 'info';
        const fileFormat = winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
            const maskedMeta = Logger.maskSecrets(meta);
            return `${timestamp} [${level}]: ${message} ${Object.keys(maskedMeta).length ? JSON.stringify(maskedMeta) : ''}`;
        }));
        const consoleFormat = winston_1.default.format.combine(winston_1.default.format.colorize({ all: true }), winston_1.default.format.timestamp({ format: 'HH:mm:ss' }), winston_1.default.format.printf(({ timestamp, level, message, ...meta }) => {
            const maskedMeta = Logger.maskSecrets(meta);
            const details = Object.keys(maskedMeta).length ? ` ${JSON.stringify(maskedMeta)}` : '';
            return `${timestamp} ${level} ${message}${details}`;
        }));
        this.logger = winston_1.default.createLogger({
            level: logLevel,
            format: fileFormat,
            transports: [
                new winston_1.default.transports.Console({ format: consoleFormat }),
                new winston_1.default.transports.File({ filename: 'reports/logs/framework.log', format: fileFormat })
            ]
        });
    }
    static getInstance() {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }
    /**
     * Generic log method that forwards to winston.
     */
    log(level, message, meta) {
        this.logger.log(level, message, meta);
    }
    info(message, meta) {
        this.logger.info(message, meta);
    }
    warn(message, meta) {
        this.logger.warn(message, meta);
    }
    error(message, meta) {
        this.logger.error(message, meta);
    }
    /**
     * Masks any key that looks like a secret before logging.
     */
    static maskSecrets(obj = {}) {
        const masked = {};
        for (const [key, value] of Object.entries(obj)) {
            if (/key|secret|token|pwd|password/i.test(key)) {
                masked[key] = '****';
            }
            else {
                masked[key] = value;
            }
        }
        return masked;
    }
}
exports.default = Logger;
//# sourceMappingURL=logger.js.map