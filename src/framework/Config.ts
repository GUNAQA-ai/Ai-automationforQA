import * as dotenv from 'dotenv';
import path from 'path';
import Logger from '../utils/logger';

/**
 * Loads environment variables from the root .env and the selected environment file.
 * Validates that all required secrets are present and provides a type‑safe accessor.
 * Secrets are never logged in plain text – they are masked when written to logs.
 */
export class Config {
  private static instance: Config;
  private readonly logger = Logger.getInstance();
  private readonly env: Record<string, string | undefined> = {};

  private constructor() {
    // Load base .env
    const basePath = path.resolve(process.cwd(), '.env');
    dotenv.config({ path: basePath });

    // Load environment‑specific file if ENVIRONMENT is set
    const envName = process.env.ENVIRONMENT;
    if (envName) {
      const envPath = path.resolve(process.cwd(), 'environments', `${envName}.env`);
      dotenv.config({ path: envPath, override: true });
    }

    // Copy to internal map
    Object.assign(this.env, process.env);

    this.validate();
  }

  /** Singleton accessor */
  public static get(): Config {
    if (!Config.instance) {
      Config.instance = new Config();
    }
    return Config.instance;
  }

  /** Get a required variable – throws if missing */
  public get(key: string): string {
    const value = this.env[key];
    if (value === undefined) {
      this.logger.error(`Missing required env variable: ${key}`);
      throw new Error(`Missing required env variable: ${key}`);
    }
    return value;
  }

  /** Helper to retrieve optional variable with fallback */
  public getOptional(key: string, fallback?: string): string | undefined {
    return this.env[key] ?? fallback;
  }

  /** Check if AI features should be enabled */
  public get aiEnabled(): boolean {
    const val = this.env['AI_ENABLE']?.toLowerCase();
    return val !== 'false' && val !== 'local' && val !== '0';
  }

  /** Get configured provider or 'local' */
  public get aiProvider(): string {
    if (!this.aiEnabled) return 'local';
    return this.env['LLM_PROVIDER']?.toLowerCase() || 'groq';
  }

  /** Mask secret values when logging */
  private mask(value: string): string {
    if (value.length <= 4) return '****';
    const visible = value.slice(0, 2) + '*'.repeat(value.length - 4) + value.slice(-2);
    return visible;
  }

  /** Validate configuration. Missing values are logged because agents can fall back locally. */
  private validate(): void {
    const provider = this.aiProvider;

    if (!this.env['BASE_URL']) {
      this.logger.warn('BASE_URL is not configured; request applicationUrl or Playwright defaults will be used');
    }

    if (this.aiEnabled) {
      const providerKey = this.env[`${provider.toUpperCase()}_API_KEY`];
      if (!providerKey && provider !== 'local') {
        this.logger.warn(`No API key configured for ${provider}; agents will use local fallback behavior when LLM calls fail`);
      }
    }

    const baseUrl = this.env['BASE_URL'];
    this.logger.info('Configuration loaded', {
      BASE_URL: baseUrl ? this.mask(baseUrl) : 'not configured',
      AI_ENABLE: this.aiEnabled,
      LLM_PROVIDER: provider,
    });
  }
}
