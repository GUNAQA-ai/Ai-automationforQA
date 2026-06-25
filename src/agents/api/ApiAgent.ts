import fetch from 'node-fetch';
import { ensureDir, pathExists, readFile, writeFile } from 'fs-extra';
import path from 'path';
import Logger from '../../utils/logger';
import { FrameworkError } from '../../framework/FrameworkError';

type RawApiDefinition = Record<string, unknown>;

interface NormalizedApiDefinition {
  name: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  expectedStatus?: number[];
  timeoutMs: number;
  execute: boolean;
  optional: boolean;
  extract: Record<string, string>;
}

interface ApiExecutionResult {
  name: string;
  method: string;
  url: string;
  expectedStatus: number[] | '2xx';
  status?: number;
  passed: boolean;
  skipped: boolean;
  optional: boolean;
  durationMs: number;
  error?: string;
  requestHeaders: Record<string, string>;
  requestBody?: unknown;
  responseHeaders?: Record<string, string>;
  responseBody?: unknown;
  extracted?: Record<string, unknown>;
}

interface ApiRunState {
  values: Record<string, unknown>;
  responses: Record<string, unknown>;
}

/**
 * ApiAgent executes API setup and API validation steps from request JSON.
 * It keeps API preconditions separate from UI generation while sharing extracted
 * response values through storage/api-state.json for later stages.
 */
export class ApiAgent {
  private readonly logger = Logger.getInstance();
  private readonly reportsDir = path.resolve('reports', 'api');
  private readonly generatedApiDir = path.resolve('generated', 'api');
  private readonly apiStatePath = path.resolve('storage', 'api-state.json');

  async run(requestFile: string): Promise<string> {
    try {
      const raw = await readFile(requestFile, 'utf-8');
      const request = this.parseRequest(raw);
      const apiDefinitions = this.extractApiDefinitions(request);
      const reportPath = path.join(this.reportsDir, 'api-summary.json');
      const execution = await this.executeApiDefinitions(apiDefinitions, request);
      const failures = execution.results.filter((result) => !result.passed && !result.optional && !result.skipped);
      const maskedDefinitions = this.maskSecrets(apiDefinitions);

      await ensureDir(this.reportsDir);
      await writeFile(reportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        requestFile: path.relative(process.cwd(), requestFile),
        count: apiDefinitions.length,
        executedCount: execution.results.filter((result) => !result.skipped).length,
        passed: failures.length === 0,
        failedCount: failures.length,
        apiDefinitions: maskedDefinitions,
        results: this.maskSecrets(execution.results),
        stateFile: path.relative(process.cwd(), this.apiStatePath),
        note: apiDefinitions.length
          ? 'API definitions were normalized and executable entries were run in sequence.'
          : 'No API definitions were found in the request file.',
      }, null, 2));

      if (apiDefinitions.length) {
        await this.writeGeneratedApiManifest(requestFile, apiDefinitions);
        await this.writeApiState(requestFile, execution.state, execution.results);
      } else {
        await this.writeApiState(requestFile, { values: {}, responses: {} }, []);
      }

      if (failures.length > 0) {
        throw new FrameworkError(`API validation failed for ${failures.length} request(s)`, undefined, 'API_FAIL');
      }

      this.logger.info(`ApiAgent: ${apiDefinitions.length} API definition(s) normalized, ${execution.results.filter((result) => !result.skipped).length} executed`);
      return reportPath;
    } catch (err) {
      if (err instanceof FrameworkError) {
        this.logger.error(err.message);
        throw err;
      }
      this.logger.error('ApiAgent failed', { error: err });
      throw new FrameworkError('API analysis failed', err as Error, 'API_FAIL');
    }
  }

  private parseRequest(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private extractApiDefinitions(request: Record<string, unknown>): NormalizedApiDefinition[] {
    const rawDefinitions = this.extractApiDefinitionsFromValue(request);
    return rawDefinitions
      .map((definition, index) => this.normalizeApiDefinition(definition, index, request))
      .filter((definition): definition is NormalizedApiDefinition => Boolean(definition));
  }

  private extractApiDefinitionsFromValue(value: unknown): RawApiDefinition[] {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.extractApiDefinitionsFromValue(entry));
    }

    if (!value || typeof value !== 'object') {
      return [];
    }

    const record = value as RawApiDefinition;
    if (this.hasEndpointShape(record)) {
      return [record];
    }

    const apiCollectionKeys = new Set([
      'apiRequests',
      'apis',
      'api',
      'endpoints',
      'setup',
      'preconditions',
      'preConditions',
      'preSteps',
      'presteps',
      'dependsOn',
      'dependencies',
    ]);

    return Object.entries(record)
      .filter(([key]) => apiCollectionKeys.has(key))
      .flatMap(([, entry]) => this.flattenApiDefinitions(entry));
  }

  private flattenApiDefinitions(value: unknown): RawApiDefinition[] {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.flattenApiDefinitions(entry));
    }

    if (!value || typeof value !== 'object') {
      return [];
    }

    const record = value as RawApiDefinition;
    if (this.hasEndpointShape(record)) {
      return [record];
    }

    const nested = this.extractApiDefinitionsFromValue(record);
    if (nested.length) return nested;

    return Object.entries(record).flatMap(([name, entry]) => {
      if (!entry || typeof entry !== 'object') return [];
      return [{ name, ...(entry as RawApiDefinition) }];
    });
  }

  private hasEndpointShape(value: RawApiDefinition): boolean {
    return ['url', 'endpoint', 'path', 'link', 'method'].some((key) => value[key] !== undefined)
      && !['locators', 'testData', 'credentials'].some((key) => value[key] !== undefined && Object.keys(value).length === 1);
  }

  private normalizeApiDefinition(
    definition: RawApiDefinition,
    index: number,
    request: Record<string, unknown>
  ): NormalizedApiDefinition | undefined {
    const rawUrl = String(
      definition.url
      ?? definition.endpoint
      ?? definition.path
      ?? definition.link
      ?? ''
    ).trim();
    if (!rawUrl) return undefined;

    const method = String(definition.method ?? 'GET').trim().toUpperCase();
    const url = this.resolveUrl(rawUrl, request);
    const headers = {
      ...this.normalizeAuthHeaders(definition),
      ...this.normalizeHeaders(definition.headers),
    };
    const expectedStatus = this.normalizeExpectedStatuses(definition);
    const timeoutMs = Number(definition.timeoutMs ?? definition.timeout ?? process.env.API_TIMEOUT_MS ?? 30_000);
    const requestExecute = request.apiExecute !== false && request.executeApis !== false;
    const execute = requestExecute && definition.execute !== false && definition.run !== false;
    const optional = Boolean(definition.optional ?? definition.continueOnFailure ?? request.apiContinueOnFailure);

    return {
      name: String(definition.name ?? `apiRequest${index + 1}`),
      method,
      url,
      headers,
      ...(definition.body !== undefined ? { body: definition.body } : {}),
      ...(definition.payload !== undefined ? { body: definition.payload } : {}),
      ...(definition.data !== undefined ? { body: definition.data } : {}),
      ...(expectedStatus.length ? { expectedStatus } : {}),
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30_000,
      execute,
      optional,
      extract: this.normalizeExtractMap(definition.extract ?? definition.extracts ?? definition.save),
    };
  }

  private resolveUrl(rawUrl: string, request: Record<string, unknown>): string {
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;

    const baseUrl = String(request.apiBaseUrl ?? request.applicationUrl ?? process.env.BASE_URL ?? '').trim();
    if (!baseUrl) return rawUrl;

    try {
      return new URL(rawUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    } catch {
      return rawUrl;
    }
  }

  private normalizeHeaders(headers: unknown): Record<string, string> {
    if (!headers || typeof headers !== 'object') return {};

    return Object.fromEntries(
      Object.entries(headers as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
    );
  }

  private normalizeAuthHeaders(definition: RawApiDefinition): Record<string, string> {
    const auth = definition.auth ?? definition.authentication;
    const headers: Record<string, string> = {};

    const bearerToken = definition.bearerToken ?? definition.accessToken ?? definition.token;
    if (bearerToken !== undefined) {
      headers.Authorization = `Bearer ${String(bearerToken)}`;
    }

    const apiKey = definition.apiKey;
    if (apiKey !== undefined) {
      if (apiKey && typeof apiKey === 'object') {
        const record = apiKey as Record<string, unknown>;
        headers[String(record.headerName ?? record.header ?? 'x-api-key')] = String(record.value ?? record.key ?? '');
      } else {
        headers['x-api-key'] = String(apiKey);
      }
    }

    if (!auth || typeof auth !== 'object') return headers;

    const record = auth as Record<string, unknown>;
    const type = String(record.type ?? '').toLowerCase();
    if (type === 'bearer' || type === 'token') {
      headers.Authorization = `Bearer ${String(record.token ?? record.value ?? '')}`;
    }

    if (type === 'basic') {
      const username = String(record.username ?? record.user ?? '');
      const password = String(record.password ?? '');
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    if (type === 'api-key' || type === 'apikey') {
      headers[String(record.headerName ?? record.header ?? 'x-api-key')] = String(record.value ?? record.key ?? '');
    }

    return headers;
  }

  private normalizeExpectedStatuses(definition: RawApiDefinition): number[] {
    const raw = definition.expectedStatus ?? definition.expectedStatuses ?? definition.status ?? definition.statusCode;
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    return values
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 100 && value <= 599);
  }

  private normalizeExtractMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== 'object') return {};

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, pathValue]) => typeof pathValue === 'string' && pathValue.trim().length > 0)
        .map(([key, pathValue]) => [key, String(pathValue).trim()])
    );
  }

  private async executeApiDefinitions(
    apiDefinitions: NormalizedApiDefinition[],
    request: Record<string, unknown>
  ): Promise<{ results: ApiExecutionResult[]; state: ApiRunState }> {
    const state: ApiRunState = { values: {}, responses: {} };
    const results: ApiExecutionResult[] = [];

    for (const definition of apiDefinitions) {
      const resolvedDefinition = this.resolveApiDefinition(definition, request, state);
      const result = resolvedDefinition.execute
        ? await this.executeApiDefinition(resolvedDefinition, state)
        : this.skippedApiResult(resolvedDefinition);

      results.push(result);
      this.captureApiState(state, resolvedDefinition, result);
    }

    return { results, state };
  }

  private resolveApiDefinition(
    definition: NormalizedApiDefinition,
    request: Record<string, unknown>,
    state: ApiRunState
  ): NormalizedApiDefinition {
    return {
      ...definition,
      url: this.resolveTemplate(definition.url, request, state),
      headers: this.resolveTemplatesInObject(definition.headers, request, state) as Record<string, string>,
      body: definition.body === undefined ? undefined : this.resolveTemplatesInObject(definition.body, request, state),
    };
  }

  private async executeApiDefinition(definition: NormalizedApiDefinition, state: ApiRunState): Promise<ApiExecutionResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), definition.timeoutMs);

    try {
      const headers = { ...definition.headers };
      const body = this.prepareRequestBody(definition, headers);
      const response = await fetch(definition.url, {
        method: definition.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        signal: controller.signal,
      });
      const responseHeaders = this.responseHeadersToObject(response.headers);
      const responseText = await response.text();
      const responseBody = this.parseResponseBody(responseText, responseHeaders['content-type']);
      const extracted = this.extractValues(definition.extract, responseBody);
      const expectedStatus = definition.expectedStatus?.length ? definition.expectedStatus : '2xx';
      const passed = Array.isArray(expectedStatus)
        ? expectedStatus.includes(response.status)
        : response.status >= 200 && response.status <= 299;

      Object.assign(state.values, extracted);

      return {
        name: definition.name,
        method: definition.method,
        url: definition.url,
        expectedStatus,
        status: response.status,
        passed,
        skipped: false,
        optional: definition.optional,
        durationMs: Date.now() - start,
        requestHeaders: headers,
        requestBody: definition.body,
        responseHeaders,
        responseBody,
        extracted,
      };
    } catch (err) {
      const expectedStatus = definition.expectedStatus?.length ? definition.expectedStatus : '2xx';
      return {
        name: definition.name,
        method: definition.method,
        url: definition.url,
        expectedStatus,
        passed: false,
        skipped: false,
        optional: definition.optional,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        requestHeaders: definition.headers,
        requestBody: definition.body,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private skippedApiResult(definition: NormalizedApiDefinition): ApiExecutionResult {
    return {
      name: definition.name,
      method: definition.method,
      url: definition.url,
      expectedStatus: definition.expectedStatus?.length ? definition.expectedStatus : '2xx',
      passed: true,
      skipped: true,
      optional: definition.optional,
      durationMs: 0,
      requestHeaders: definition.headers,
      requestBody: definition.body,
    };
  }

  private prepareRequestBody(definition: NormalizedApiDefinition, headers: Record<string, string>): string | undefined {
    if (definition.body === undefined || ['GET', 'HEAD'].includes(definition.method)) return undefined;
    if (typeof definition.body === 'string') return definition.body;

    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
    if (!hasContentType) headers['content-type'] = 'application/json';
    return JSON.stringify(definition.body);
  }

  private responseHeadersToObject(headers: { forEach: (callback: (value: string, key: string) => void) => void }): Record<string, string> {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key.toLowerCase()] = value;
    });
    return output;
  }

  private parseResponseBody(responseText: string, contentType = ''): unknown {
    if (!responseText) return undefined;
    if (/json/i.test(contentType)) {
      try {
        return JSON.parse(responseText);
      } catch {
        return responseText;
      }
    }
    return responseText;
  }

  private extractValues(extractMap: Record<string, string>, responseBody: unknown): Record<string, unknown> {
    const extracted: Record<string, unknown> = {};
    for (const [key, selector] of Object.entries(extractMap)) {
      const value = this.readJsonPath(responseBody, selector);
      if (value !== undefined) extracted[key] = value;
    }
    return extracted;
  }

  private readJsonPath(value: unknown, selector: string): unknown {
    const normalized = selector.replace(/^\$\./, '').replace(/^\$/, '').trim();
    if (!normalized) return value;

    return normalized.split('.').reduce<unknown>((current, segment) => {
      if (current === undefined || current === null) return undefined;
      const arrayMatch = segment.match(/^([^\[]+)\[(\d+)\]$/);
      if (arrayMatch) {
        const record = current as Record<string, unknown>;
        const arrayValue = record[arrayMatch[1]];
        return Array.isArray(arrayValue) ? arrayValue[Number(arrayMatch[2])] : undefined;
      }
      if (/^\d+$/.test(segment) && Array.isArray(current)) return current[Number(segment)];
      if (typeof current === 'object') return (current as Record<string, unknown>)[segment];
      return undefined;
    }, value);
  }

  private captureApiState(state: ApiRunState, definition: NormalizedApiDefinition, result: ApiExecutionResult): void {
    state.responses[definition.name] = {
      status: result.status,
      passed: result.passed,
      body: result.responseBody,
      extracted: result.extracted ?? {},
    };

    if (result.extracted) {
      for (const [key, value] of Object.entries(result.extracted)) {
        state.values[key] = value;
        state.values[`${definition.name}.${key}`] = value;
      }
    }
  }

  private resolveTemplatesInObject(value: unknown, request: Record<string, unknown>, state: ApiRunState): unknown {
    if (typeof value === 'string') return this.resolveTemplate(value, request, state);
    if (Array.isArray(value)) return value.map((entry) => this.resolveTemplatesInObject(entry, request, state));
    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, entry]) => [key, this.resolveTemplatesInObject(entry, request, state)])
    );
  }

  private resolveTemplate(value: string, request: Record<string, unknown>, state: ApiRunState): string {
    return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
      const resolved = this.lookupTemplateValue(String(expression).trim(), request, state);
      if (resolved === undefined || resolved === null) return match;
      return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
    });
  }

  private lookupTemplateValue(expression: string, request: Record<string, unknown>, state: ApiRunState): unknown {
    if (/^env:/i.test(expression)) {
      return process.env[expression.replace(/^env:/i, '')];
    }

    const context = {
      request,
      testData: request.testData,
      credentials: request.credentials,
      api: state.responses,
      values: state.values,
      env: process.env,
    };

    return state.values[expression]
      ?? this.readJsonPath(context, expression)
      ?? (request.testData && typeof request.testData === 'object' ? this.readJsonPath(request.testData, expression) : undefined)
      ?? (request.credentials && typeof request.credentials === 'object' ? this.readJsonPath(request.credentials, expression) : undefined)
      ?? process.env[expression];
  }

  private async writeApiState(requestFile: string, state: ApiRunState, results: ApiExecutionResult[]): Promise<void> {
    await ensureDir(path.dirname(this.apiStatePath));
    await writeFile(this.apiStatePath, JSON.stringify(this.maskSecrets({
      generatedAt: new Date().toISOString(),
      requestFile: path.relative(process.cwd(), requestFile),
      values: state.values,
      responses: state.responses,
      results,
    }), null, 2));
  }

  private async writeGeneratedApiManifest(requestFile: string, apiDefinitions: NormalizedApiDefinition[]): Promise<void> {
    await ensureDir(this.generatedApiDir);
    const baseName = path.basename(requestFile, path.extname(requestFile)).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'api';
    const filePath = await this.uniquePath(path.join(this.generatedApiDir, `${baseName}-api-manifest.json`));

    await writeFile(filePath, JSON.stringify({
      generatedAt: new Date().toISOString(),
      apiDefinitions: this.maskSecrets(apiDefinitions),
    }, null, 2));
    this.logger.info(`ApiAgent: generated API manifest at ${filePath}`);
  }

  private maskSecrets(value: unknown, keyHint = ''): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.maskSecrets(entry, keyHint));
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .map(([key, entry]) => [key, this.maskSecrets(entry, key)])
      );
    }

    if (typeof value !== 'string') return value;
    if (this.isSecretKey(keyHint)) return '****';
    if (/^(bearer|basic)\s+[a-z0-9+/=._-]+$/i.test(value)) return value.replace(/^(\S+)\s+.+$/, '$1 ****');
    return value;
  }

  private isSecretKey(key: string): boolean {
    return /authorization|cookie|token|secret|password|api[-_]?key|client[-_]?secret/i.test(key);
  }

  private async uniquePath(filePath: string): Promise<string> {
    if (!await pathExists(filePath)) return filePath;

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    let index = 2;
    let candidate = path.join(dir, `${base}_${index}${ext}`);

    while (await pathExists(candidate)) {
      index += 1;
      candidate = path.join(dir, `${base}_${index}${ext}`);
    }

    return candidate;
  }
}
