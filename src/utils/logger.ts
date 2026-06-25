import winston from 'winston';

/**
 * Centralised logger used across the framework.
 * Supports console and file transports, with optional JSON formatting.
 * The log level is driven by the LOG_LEVEL env variable (default: 'info').
 * Secrets are masked using the maskSecrets helper.
 */
class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor() {
    const logLevel = process.env.LOG_LEVEL || 'info';
    const fileFormat = winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const maskedMeta = Logger.maskSecrets(meta);
        return `${timestamp} [${level}]: ${message} ${Object.keys(maskedMeta).length ? JSON.stringify(maskedMeta) : ''}`;
      })
    );
    const consoleFormat = winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const maskedMeta = Logger.maskSecrets(meta);
        const details = Object.keys(maskedMeta).length ? ` ${JSON.stringify(maskedMeta)}` : '';
        return `${timestamp} ${level} ${message}${details}`;
      })
    );

    this.logger = winston.createLogger({
      level: logLevel,
      format: fileFormat,
      transports: [
        new winston.transports.Console({ format: consoleFormat }),
        new winston.transports.File({ filename: 'reports/logs/framework.log', format: fileFormat })
      ]
    });
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  /**
   * Generic log method that forwards to winston.
   */
  public log(level: string, message: string, meta?: Record<string, unknown>) {
    this.logger.log(level, message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>) {
    this.logger.info(message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>) {
    this.logger.warn(message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>) {
    this.logger.error(message, meta);
  }

  /**
   * Masks any key that looks like a secret before logging.
   */
  private static maskSecrets(obj: Record<string, unknown> = {}): Record<string, unknown> {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/key|secret|token|pwd|password/i.test(key)) {
        masked[key] = '****';
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
}

export default Logger;
