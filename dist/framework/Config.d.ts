/**
 * Loads environment variables from the root .env and the selected environment file.
 * Validates that all required secrets are present and provides a type‑safe accessor.
 * Secrets are never logged in plain text – they are masked when written to logs.
 */
export declare class Config {
    private static instance;
    private readonly logger;
    private readonly env;
    private constructor();
    /** Singleton accessor */
    static get(): Config;
    /** Get a required variable – throws if missing */
    get(key: string): string;
    /** Helper to retrieve optional variable with fallback */
    getOptional(key: string, fallback?: string): string | undefined;
    /** Check if AI features should be enabled */
    get aiEnabled(): boolean;
    /** Get configured provider or 'local' */
    get aiProvider(): string;
    /** Mask secret values when logging */
    private mask;
    /** Validate configuration. Missing values are logged because agents can fall back locally. */
    private validate;
}
//# sourceMappingURL=Config.d.ts.map