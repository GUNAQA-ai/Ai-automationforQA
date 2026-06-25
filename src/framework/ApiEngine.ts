import { request, APIRequestContext, APIResponse, expect } from '@playwright/test';
import Logger from '../utils/logger';

/**
 * ApiEngine - Handles REST API automation (GET, POST, PUT, PATCH, DELETE)
 * with authentication and response assertions.
 */
export class ApiEngine {
  private readonly logger = Logger.getInstance();
  private requestContext?: APIRequestContext;

  /**
   * Initialize API Request Context with base URL and default headers.
   */
  async init(baseUrl?: string, extraHeaders?: Record<string, string>): Promise<void> {
    this.logger.info(`Initializing ApiEngine with Base URL: ${baseUrl}`);
    this.requestContext = await request.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(extraHeaders ?? {})
      }
    });
  }

  private getContext(): APIRequestContext {
    if (!this.requestContext) {
      throw new Error('API Context not initialized. Call init() first.');
    }
    return this.requestContext;
  }

  /**
   * Perform an HTTP Request.
   */
  async sendRequest(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options?: {
      headers?: Record<string, string>;
      params?: Record<string, string | number | boolean>;
      data?: any;
    }
  ): Promise<APIResponse> {
    const ctx = this.getContext();
    this.logger.info(`API: Sending ${method} to ${url}`);
    
    const requestOptions = {
      headers: options?.headers,
      params: options?.params,
      data: options?.data,
    };

    switch (method) {
      case 'GET':
        return await ctx.get(url, requestOptions);
      case 'POST':
        return await ctx.post(url, requestOptions);
      case 'PUT':
        return await ctx.put(url, requestOptions);
      case 'PATCH':
        return await ctx.patch(url, requestOptions);
      case 'DELETE':
        return await ctx.delete(url, requestOptions);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }

  /**
   * Validate the API Response status code.
   */
  async validateStatus(response: APIResponse, expectedStatus: number): Promise<void> {
    this.logger.info(`API: Validating response status is ${expectedStatus}`);
    expect(response.status()).toBe(expectedStatus);
  }

  /**
   * Validate that the API Response contains expected JSON properties or values.
   */
  async validateResponseBody(response: APIResponse, expectedSubset: Record<string, any>): Promise<void> {
    this.logger.info('API: Validating response body subset match');
    const json = await response.json();
    expect(json).toMatchObject(expectedSubset);
  }

  /**
   * Validate that the API Response body text contains a substring.
   */
  async validateResponseText(response: APIResponse, substring: string): Promise<void> {
    this.logger.info(`API: Validating response body contains text: ${substring}`);
    const text = await response.text();
    expect(text).toContain(substring);
  }

  /**
   * Combined API Action (Level 16) - Combines all API methods, authentications, schema, and retry validations.
   */
  async apiAction(
    action: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'authenticate' | 'generateToken' | 'validateResponse' | 'validateSchema' | 'retryApi',
    url: string,
    options?: {
      headers?: Record<string, string>;
      params?: Record<string, string | number | boolean>;
      data?: any;
      expectedStatus?: number;
      expectedSubset?: Record<string, any>;
      expectedText?: string;
      schema?: any; // For schema validation
      authCredentials?: { username?: string; password?: string; tokenUrl?: string };
      retryAttempts?: number;
    }
  ): Promise<any> {
    const attempts = options?.retryAttempts ?? 1;
    let lastError: any = null;

    this.logger.info(`ApiEngine: Executing API Action "${action}" on "${url}"`);

    const runCall = async () => {
      const headers = { ...options?.headers };
      if (process.env.API_BEARER_TOKEN) {
        headers['Authorization'] = `Bearer ${process.env.API_BEARER_TOKEN}`;
      }

      switch (action) {
        case 'get':
          return await this.sendRequest('GET', url, { headers, params: options?.params });
        case 'post':
          return await this.sendRequest('POST', url, { headers, data: options?.data });
        case 'put':
          return await this.sendRequest('PUT', url, { headers, data: options?.data });
        case 'patch':
          return await this.sendRequest('PATCH', url, { headers, data: options?.data });
        case 'delete':
          return await this.sendRequest('DELETE', url, { headers, params: options?.params });
        case 'authenticate':
        case 'generateToken':
          const authUrl = options?.authCredentials?.tokenUrl ?? url;
          const authData = options?.authCredentials ?? options?.data ?? {};
          const res = await this.sendRequest('POST', authUrl, { data: authData });
          if (res.ok()) {
            const body = await res.json().catch(() => ({}));
            const token = body.token ?? body.accessToken ?? body.id_token;
            if (token) {
              process.env.API_BEARER_TOKEN = token;
              this.logger.info(`ApiEngine: Authentication token successfully stored in env`);
              return token;
            }
          }
          throw new Error(`Authentication failed with status ${res.status()}`);
        default:
          throw new Error(`Action ${action} is not a primary request method`);
      }
    };

    if (['get', 'post', 'put', 'patch', 'delete', 'authenticate', 'generateToken', 'retryApi'].includes(action)) {
      let attempt = 0;
      const targetAttempts = action === 'retryApi' ? attempts : 1;
      const realAction = action === 'retryApi' ? 'get' : action; // default retry to get or let option specify
      
      while (attempt < targetAttempts) {
        try {
          attempt++;
          return await runCall();
        } catch (err) {
          lastError = err;
          if (attempt < targetAttempts) {
            this.logger.warn(`ApiEngine: API call failed on attempt ${attempt}. Retrying...`);
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      throw lastError;
    }

    // Custom validations
    if (action === 'validateResponse') {
      const res = options?.data as APIResponse;
      if (!res) throw new Error(`validateResponse requires response object in options.data`);
      if (options?.expectedStatus) {
        await this.validateStatus(res, options.expectedStatus);
      }
      if (options?.expectedSubset) {
        await this.validateResponseBody(res, options.expectedSubset);
      }
      if (options?.expectedText) {
        await this.validateResponseText(res, options.expectedText);
      }
      return true;
    }

    if (action === 'validateSchema') {
      const res = options?.data as APIResponse;
      if (!res) throw new Error(`validateSchema requires response object in options.data`);
      const json = await res.json();
      if (options?.schema && typeof options.schema === 'object') {
        for (const key of Object.keys(options.schema)) {
          if (!(key in json)) {
            throw new Error(`Schema validation failed: missing property "${key}"`);
          }
        }
      }
      this.logger.info(`ApiEngine: Schema validation passed`);
      return true;
    }

    throw new Error(`Unsupported API action: ${action}`);
  }

  /**
   * Close the request context and clean up.
   */
  async dispose(): Promise<void> {
    if (this.requestContext) {
      this.logger.info('Disposing ApiEngine request context');
      await this.requestContext.dispose();
    }
  }
}
