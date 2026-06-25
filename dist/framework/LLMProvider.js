"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMProviderFactory = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const logger_1 = __importDefault(require("../utils/logger"));
const Config_1 = require("./Config");
/**
 * Factory that returns the appropriate provider based on the `LLM_PROVIDER`
 * environment variable. Supported values: "groq", "openai", "ollama".
 */
class LLMProviderFactory {
    static getProvider() {
        const config = Config_1.Config.get();
        if (!config.aiEnabled || config.aiProvider === 'local') {
            LLMProviderFactory.logger.info(`AI features disabled. Selecting LocalProvider.`);
            return new LocalProvider();
        }
        const provider = config.aiProvider;
        LLMProviderFactory.logger.info(`Selecting LLM provider: ${provider}`);
        const chosenProvider = LLMProviderFactory.instantiateProvider(provider);
        return new ResilientLLMProvider(chosenProvider);
    }
    static instantiateProvider(provider) {
        switch (provider) {
            case 'groq':
                return new GroqProvider();
            case 'openai':
                return new OpenAIProvider();
            case 'ollama':
                return new OllamaProvider();
            default:
                LLMProviderFactory.logger.warn(`Unknown LLM provider "${provider}", falling back to LocalProvider`);
                return new LocalProvider();
        }
    }
}
exports.LLMProviderFactory = LLMProviderFactory;
LLMProviderFactory.logger = logger_1.default.getInstance();
class ResilientLLMProvider {
    constructor(primary) {
        this.primary = primary;
    }
    async generate(prompt) {
        try {
            return await this.primary.generate(prompt);
        }
        catch (err) {
            logger_1.default.getInstance().warn(`Primary LLM provider failed: ${err.message}. Attempting dynamic fallback...`);
            if (process.env.GROQ_API_KEY && !(this.primary instanceof GroqProvider)) {
                try {
                    logger_1.default.getInstance().info('Falling back to Groq LLM provider...');
                    const groq = new GroqProvider();
                    return await groq.generate(prompt);
                }
                catch (groqErr) {
                    logger_1.default.getInstance().warn(`Groq fallback failed: ${groqErr.message}`);
                }
            }
            if (process.env.OPENAI_API_KEY && !(this.primary instanceof OpenAIProvider)) {
                try {
                    logger_1.default.getInstance().info('Falling back to OpenAI LLM provider...');
                    const openai = new OpenAIProvider();
                    return await openai.generate(prompt);
                }
                catch (openaiErr) {
                    logger_1.default.getInstance().warn(`OpenAI fallback failed: ${openaiErr.message}`);
                }
            }
            if (!(this.primary instanceof OllamaProvider)) {
                try {
                    logger_1.default.getInstance().info('Falling back to Ollama LLM provider...');
                    const ollama = new OllamaProvider();
                    return await ollama.generate(prompt);
                }
                catch (ollamaErr) {
                    logger_1.default.getInstance().warn(`Ollama fallback failed: ${ollamaErr.message}`);
                }
            }
            logger_1.default.getInstance().warn('All LLM providers failed. Using LocalProvider fallback.');
            return await new LocalProvider().generate(prompt);
        }
    }
}
/** -------------------- Implementations -------------------- */
class LocalProvider {
    async generate(prompt) {
        logger_1.default.getInstance().info('LocalProvider triggered. AI is disabled, returning empty string for LLM prompt.');
        return ''; // Bypasses the LLM completely
    }
}
class GroqProvider {
    constructor() {
        this.apiKey = process.env.GROQ_API_KEY;
        this.endpoint = 'https://api.groq.com/openai/v1/chat/completions';
    }
    async generate(prompt) {
        if (!this.apiKey)
            throw new Error('GROQ_API_KEY not set');
        const body = {
            model: process.env.GROQ_MODEL || process.env.LLM_MODEL || 'llama-3.3-70b-versatile',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1,
            max_tokens: 4096,
        };
        let response = await fetchWithTimeout(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        if (response.status === 429) {
            const errorText = await response.clone().text();
            const waitMatch = errorText.match(/try again in ([\d.]+)s/i);
            if (waitMatch) {
                const waitTime = parseFloat(waitMatch[1]) * 1000 + 1000;
                logger_1.default.getInstance().warn(`Groq rate limit reached for ${body.model}. Waiting ${Math.round(waitTime / 1000)}s before retrying...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                response = await fetchWithTimeout(this.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify(body),
                });
            }
            else {
                logger_1.default.getInstance().warn(`Groq rate limit reached but no wait time provided in error message. Error: ${errorText}`);
            }
        }
        await ensureOk(response, 'Groq');
        const data = await response.json();
        return data?.choices?.[0]?.message?.content?.trim() ?? '';
    }
}
class OpenAIProvider {
    constructor() {
        this.apiKey = process.env.OPENAI_API_KEY;
        this.endpoint = process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
    }
    async generate(prompt) {
        if (!this.apiKey)
            throw new Error('OPENAI_API_KEY not set');
        const body = {
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
        };
        const response = await fetchWithTimeout(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
        });
        await ensureOk(response, 'OpenAI');
        const data = await response.json();
        return data?.choices?.[0]?.message?.content?.trim() ?? '';
    }
}
class OllamaProvider {
    constructor() {
        this.endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate';
    }
    async generate(prompt) {
        const body = {
            model: process.env.OLLAMA_MODEL || 'llama3',
            prompt: prompt,
            stream: false,
            options: {
                temperature: 0.2
            }
        };
        const response = await fetchWithTimeout(this.endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        }, Number(process.env.OLLAMA_TIMEOUT_MS) || 45000);
        await ensureOk(response, 'Ollama');
        const data = await response.json();
        return data?.response?.trim() ?? '';
    }
}
async function fetchWithTimeout(url, options, timeoutMs = 45000) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await (0, node_fetch_1.default)(url, {
            ...options,
            signal: controller.signal,
        });
        return response;
    }
    catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
        }
        throw error;
    }
    finally {
        clearTimeout(id);
    }
}
async function ensureOk(response, provider) {
    if (response.ok)
        return;
    const body = await response.text();
    throw new Error(`${provider} LLM request failed with ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
}
//# sourceMappingURL=LLMProvider.js.map