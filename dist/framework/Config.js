"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Config = void 0;
const dotenv = __importStar(require("dotenv"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Loads environment variables from the root .env and the selected environment file.
 * Validates that all required secrets are present and provides a type‑safe accessor.
 * Secrets are never logged in plain text – they are masked when written to logs.
 */
class Config {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.env = {};
        // Load base .env
        const basePath = path_1.default.resolve(process.cwd(), '.env');
        dotenv.config({ path: basePath });
        // Load environment‑specific file if ENVIRONMENT is set
        const envName = process.env.ENVIRONMENT;
        if (envName) {
            const envPath = path_1.default.resolve(process.cwd(), 'environments', `${envName}.env`);
            dotenv.config({ path: envPath, override: true });
        }
        // Copy to internal map
        Object.assign(this.env, process.env);
        this.validate();
    }
    /** Singleton accessor */
    static get() {
        if (!Config.instance) {
            Config.instance = new Config();
        }
        return Config.instance;
    }
    /** Get a required variable – throws if missing */
    get(key) {
        const value = this.env[key];
        if (value === undefined) {
            this.logger.error(`Missing required env variable: ${key}`);
            throw new Error(`Missing required env variable: ${key}`);
        }
        return value;
    }
    /** Helper to retrieve optional variable with fallback */
    getOptional(key, fallback) {
        return this.env[key] ?? fallback;
    }
    /** Check if AI features should be enabled */
    get aiEnabled() {
        const val = this.env['AI_ENABLE']?.toLowerCase();
        return val !== 'false' && val !== 'local' && val !== '0';
    }
    /** Get configured provider or 'local' */
    get aiProvider() {
        if (!this.aiEnabled)
            return 'local';
        return this.env['LLM_PROVIDER']?.toLowerCase() || 'groq';
    }
    /** Mask secret values when logging */
    mask(value) {
        if (value.length <= 4)
            return '****';
        const visible = value.slice(0, 2) + '*'.repeat(value.length - 4) + value.slice(-2);
        return visible;
    }
    /** Validate configuration. Missing values are logged because agents can fall back locally. */
    validate() {
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
exports.Config = Config;
//# sourceMappingURL=Config.js.map