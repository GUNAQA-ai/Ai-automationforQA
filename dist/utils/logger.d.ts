/**
 * Centralised logger used across the framework.
 * Supports console and file transports, with optional JSON formatting.
 * The log level is driven by the LOG_LEVEL env variable (default: 'info').
 * Secrets are masked using the maskSecrets helper.
 */
declare class Logger {
    private static instance;
    private logger;
    private constructor();
    static getInstance(): Logger;
    /**
     * Generic log method that forwards to winston.
     */
    log(level: string, message: string, meta?: Record<string, unknown>): void;
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    /**
     * Masks any key that looks like a secret before logging.
     */
    private static maskSecrets;
}
export default Logger;
//# sourceMappingURL=logger.d.ts.map