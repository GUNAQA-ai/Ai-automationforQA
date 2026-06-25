import fetch from 'node-fetch';
import type { Response as FetchResponse } from 'node-fetch';
import Logger from '../utils/logger';
import { Config } from './Config';

/**
 * Generic interface for LLM providers.
 */
export interface LLMProvider {
  /**
   * Send a prompt to the LLM and receive a response.
   * @param prompt The user prompt or system instruction.
   */
  generate(prompt: string): Promise<string>;
}

/**
 * Factory that returns the appropriate provider based on the `LLM_PROVIDER`
 * environment variable. Supported values: "groq", "openai", "ollama".
 */
export class LLMProviderFactory {
  private static logger = Logger.getInstance();

  static getProvider(): LLMProvider {
    const config = Config.get();
    if (!config.aiEnabled || config.aiProvider === 'local') {
      LLMProviderFactory.logger.info(`AI features disabled. Selecting LocalProvider.`);
      return new LocalProvider();
    }

    const provider = config.aiProvider;
    LLMProviderFactory.logger.info(`⚡ AI Engine Active: Starting with ${provider.toUpperCase()}`);
    const chosenProvider = LLMProviderFactory.instantiateProvider(provider);
    return new ResilientLLMProvider(chosenProvider);
  }

  private static instantiateProvider(provider: string): LLMProvider {
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

class ResilientLLMProvider implements LLMProvider {
  constructor(private primary: LLMProvider) {}

  async generate(prompt: string): Promise<string> {
    try {
      return await this.primary.generate(prompt);
    } catch (err) {
      // Quietly fall back without dumping massive error traces
      if (process.env.GROQ_API_KEY && !(this.primary instanceof GroqProvider)) {
        try {
          const groq = new GroqProvider();
          const res = await groq.generate(prompt);
          Logger.getInstance().info(`⚡ AI Engine: Successfully switched to GROQ`);
          return res;
        } catch (groqErr) {
          // Quietly suppress
        }
      }

      if (!(this.primary instanceof OllamaProvider)) {
        try {
          Logger.getInstance().info('⚡ AI Engine: Waiting for OLLAMA (4m timeout)...');
          const ollama = new OllamaProvider();
          const res = await ollama.generate(prompt);
          return res;
        } catch (ollamaErr) {
          // Quietly suppress
        }
      }

      Logger.getInstance().info('⚡ AI Engine: APIs unavailable. Using LOCAL CODE generator.');
      return await new LocalProvider().generate(prompt);
    }
  }
}

/** -------------------- Implementations -------------------- */

class LocalProvider implements LLMProvider {
  async generate(prompt: string): Promise<string> {
    return ''; // Bypasses the LLM completely, deferring to the framework's native AST mapping
  }
}

class GroqProvider implements LLMProvider {
  private apiKey = process.env.GROQ_API_KEY;
  private endpoint = 'https://api.groq.com/openai/v1/chat/completions';

  async generate(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('GROQ_API_KEY not set');
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
      throw new Error('Groq Rate Limit Exceeded - Quiet Fallback Triggered');
    }

    await ensureOk(response, 'Groq');
    const data:any = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? '';
  }
}

class OpenAIProvider implements LLMProvider {
  private apiKey = process.env.OPENAI_API_KEY;
  private endpoint = process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';

  async generate(prompt: string): Promise<string> {
    if (!this.apiKey) throw new Error('OPENAI_API_KEY not set');
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
    const data:any = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? '';
  }
}

class OllamaProvider implements LLMProvider {
  private endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434/api/generate';

  async generate(prompt: string): Promise<string> {
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
    }, Number(process.env.OLLAMA_TIMEOUT_MS) || 240000); // 4 minute timeout for Ollama
    await ensureOk(response, 'Ollama');
    const data:any = await response.json();
    return data?.response?.trim() ?? '';
  }
}

async function fetchWithTimeout(url: string, options: any, timeoutMs = 45000): Promise<FetchResponse> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal as any,
    });
    return response;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}

async function ensureOk(response: FetchResponse, provider: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${provider} LLM request failed with ${response.status}`);
}
