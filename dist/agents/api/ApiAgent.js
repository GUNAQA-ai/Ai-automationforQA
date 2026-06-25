"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiAgent = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../../utils/logger"));
const FrameworkError_1 = require("../../framework/FrameworkError");
/**
 * ApiAgent executes API setup and API validation steps from request JSON.
 * It keeps API preconditions separate from UI generation while sharing extracted
 * response values through storage/api-state.json for later stages.
 */
class ApiAgent {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.reportsDir = path_1.default.resolve('reports', 'api');
        this.generatedApiDir = path_1.default.resolve('generated', 'api');
        this.apiStatePath = path_1.default.resolve('storage', 'api-state.json');
    }
    async run(requestFile) {
        try {
            const raw = await (0, fs_extra_1.readFile)(requestFile, 'utf-8');
            const request = this.parseRequest(raw);
            const apiDefinitions = this.extractApiDefinitions(request);
            const reportPath = path_1.default.join(this.reportsDir, 'api-summary.json');
            const execution = await this.executeApiDefinitions(apiDefinitions, request);
            const failures = execution.results.filter((result) => !result.passed && !result.optional && !result.skipped);
            const maskedDefinitions = this.maskSecrets(apiDefinitions);
            await (0, fs_extra_1.ensureDir)(this.reportsDir);
            await (0, fs_extra_1.writeFile)(reportPath, JSON.stringify({
                generatedAt: new Date().toISOString(),
                requestFile: path_1.default.relative(process.cwd(), requestFile),
                count: apiDefinitions.length,
                executedCount: execution.results.filter((result) => !result.skipped).length,
                passed: failures.length === 0,
                failedCount: failures.length,
                apiDefinitions: maskedDefinitions,
                results: this.maskSecrets(execution.results),
                stateFile: path_1.default.relative(process.cwd(), this.apiStatePath),
                note: apiDefinitions.length
                    ? 'API definitions were normalized and executable entries were run in sequence.'
                    : 'No API definitions were found in the request file.',
            }, null, 2));
            if (apiDefinitions.length) {
                await this.writeGeneratedApiManifest(requestFile, apiDefinitions);
                await this.writeApiState(requestFile, execution.state, execution.results);
            }
            else {
                await this.writeApiState(requestFile, { values: {}, responses: {} }, []);
            }
            if (failures.length > 0) {
                throw new FrameworkError_1.FrameworkError(`API validation failed for ${failures.length} request(s)`, undefined, 'API_FAIL');
            }
            this.logger.info(`ApiAgent: ${apiDefinitions.length} API definition(s) normalized, ${execution.results.filter((result) => !result.skipped).length} executed`);
            return reportPath;
        }
        catch (err) {
            if (err instanceof FrameworkError_1.FrameworkError) {
                this.logger.error(err.message);
                throw err;
            }
            this.logger.error('ApiAgent failed', { error: err });
            throw new FrameworkError_1.FrameworkError('API analysis failed', err, 'API_FAIL');
        }
    }
    parseRequest(raw) {
        try {
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
        catch {
            return {};
        }
    }
    extractApiDefinitions(request) {
        const rawDefinitions = this.extractApiDefinitionsFromValue(request);
        return rawDefinitions
            .map((definition, index) => this.normalizeApiDefinition(definition, index, request))
            .filter((definition) => Boolean(definition));
    }
    extractApiDefinitionsFromValue(value) {
        if (Array.isArray(value)) {
            return value.flatMap((entry) => this.extractApiDefinitionsFromValue(entry));
        }
        if (!value || typeof value !== 'object') {
            return [];
        }
        const record = value;
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
    flattenApiDefinitions(value) {
        if (Array.isArray(value)) {
            return value.flatMap((entry) => this.flattenApiDefinitions(entry));
        }
        if (!value || typeof value !== 'object') {
            return [];
        }
        const record = value;
        if (this.hasEndpointShape(record)) {
            return [record];
        }
        const nested = this.extractApiDefinitionsFromValue(record);
        if (nested.length)
            return nested;
        return Object.entries(record).flatMap(([name, entry]) => {
            if (!entry || typeof entry !== 'object')
                return [];
            return [{ name, ...entry }];
        });
    }
    hasEndpointShape(value) {
        return ['url', 'endpoint', 'path', 'link', 'method'].some((key) => value[key] !== undefined)
            && !['locators', 'testData', 'credentials'].some((key) => value[key] !== undefined && Object.keys(value).length === 1);
    }
    normalizeApiDefinition(definition, index, request) {
        const rawUrl = String(definition.url
            ?? definition.endpoint
            ?? definition.path
            ?? definition.link
            ?? '').trim();
        if (!rawUrl)
            return undefined;
        const method = String(definition.method ?? 'GET').trim().toUpperCase();
        const url = this.resolveUrl(rawUrl, request);
        const headers = {
            ...this.normalizeAuthHeaders(definition),
            ...this.normalizeHeaders(definition.headers),
        };
        const expectedStatus = this.normalizeExpectedStatuses(definition);
        const timeoutMs = Number(definition.timeoutMs ?? definition.timeout ?? process.env.API_TIMEOUT_MS ?? 30000);
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
            timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 30000,
            execute,
            optional,
            extract: this.normalizeExtractMap(definition.extract ?? definition.extracts ?? definition.save),
        };
    }
    resolveUrl(rawUrl, request) {
        if (/^https?:\/\//i.test(rawUrl))
            return rawUrl;
        const baseUrl = String(request.apiBaseUrl ?? request.applicationUrl ?? process.env.BASE_URL ?? '').trim();
        if (!baseUrl)
            return rawUrl;
        try {
            return new URL(rawUrl, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
        }
        catch {
            return rawUrl;
        }
    }
    normalizeHeaders(headers) {
        if (!headers || typeof headers !== 'object')
            return {};
        return Object.fromEntries(Object.entries(headers)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)]));
    }
    normalizeAuthHeaders(definition) {
        const auth = definition.auth ?? definition.authentication;
        const headers = {};
        const bearerToken = definition.bearerToken ?? definition.accessToken ?? definition.token;
        if (bearerToken !== undefined) {
            headers.Authorization = `Bearer ${String(bearerToken)}`;
        }
        const apiKey = definition.apiKey;
        if (apiKey !== undefined) {
            if (apiKey && typeof apiKey === 'object') {
                const record = apiKey;
                headers[String(record.headerName ?? record.header ?? 'x-api-key')] = String(record.value ?? record.key ?? '');
            }
            else {
                headers['x-api-key'] = String(apiKey);
            }
        }
        if (!auth || typeof auth !== 'object')
            return headers;
        const record = auth;
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
    normalizeExpectedStatuses(definition) {
        const raw = definition.expectedStatus ?? definition.expectedStatuses ?? definition.status ?? definition.statusCode;
        const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
        return values
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value >= 100 && value <= 599);
    }
    normalizeExtractMap(value) {
        if (!value || typeof value !== 'object')
            return {};
        return Object.fromEntries(Object.entries(value)
            .filter(([, pathValue]) => typeof pathValue === 'string' && pathValue.trim().length > 0)
            .map(([key, pathValue]) => [key, String(pathValue).trim()]));
    }
    async executeApiDefinitions(apiDefinitions, request) {
        const state = { values: {}, responses: {} };
        const results = [];
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
    resolveApiDefinition(definition, request, state) {
        return {
            ...definition,
            url: this.resolveTemplate(definition.url, request, state),
            headers: this.resolveTemplatesInObject(definition.headers, request, state),
            body: definition.body === undefined ? undefined : this.resolveTemplatesInObject(definition.body, request, state),
        };
    }
    async executeApiDefinition(definition, state) {
        const start = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), definition.timeoutMs);
        try {
            const headers = { ...definition.headers };
            const body = this.prepareRequestBody(definition, headers);
            const response = await (0, node_fetch_1.default)(definition.url, {
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
        }
        catch (err) {
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
        }
        finally {
            clearTimeout(timeout);
        }
    }
    skippedApiResult(definition) {
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
    prepareRequestBody(definition, headers) {
        if (definition.body === undefined || ['GET', 'HEAD'].includes(definition.method))
            return undefined;
        if (typeof definition.body === 'string')
            return definition.body;
        const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
        if (!hasContentType)
            headers['content-type'] = 'application/json';
        return JSON.stringify(definition.body);
    }
    responseHeadersToObject(headers) {
        const output = {};
        headers.forEach((value, key) => {
            output[key.toLowerCase()] = value;
        });
        return output;
    }
    parseResponseBody(responseText, contentType = '') {
        if (!responseText)
            return undefined;
        if (/json/i.test(contentType)) {
            try {
                return JSON.parse(responseText);
            }
            catch {
                return responseText;
            }
        }
        return responseText;
    }
    extractValues(extractMap, responseBody) {
        const extracted = {};
        for (const [key, selector] of Object.entries(extractMap)) {
            const value = this.readJsonPath(responseBody, selector);
            if (value !== undefined)
                extracted[key] = value;
        }
        return extracted;
    }
    readJsonPath(value, selector) {
        const normalized = selector.replace(/^\$\./, '').replace(/^\$/, '').trim();
        if (!normalized)
            return value;
        return normalized.split('.').reduce((current, segment) => {
            if (current === undefined || current === null)
                return undefined;
            const arrayMatch = segment.match(/^([^\[]+)\[(\d+)\]$/);
            if (arrayMatch) {
                const record = current;
                const arrayValue = record[arrayMatch[1]];
                return Array.isArray(arrayValue) ? arrayValue[Number(arrayMatch[2])] : undefined;
            }
            if (/^\d+$/.test(segment) && Array.isArray(current))
                return current[Number(segment)];
            if (typeof current === 'object')
                return current[segment];
            return undefined;
        }, value);
    }
    captureApiState(state, definition, result) {
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
    resolveTemplatesInObject(value, request, state) {
        if (typeof value === 'string')
            return this.resolveTemplate(value, request, state);
        if (Array.isArray(value))
            return value.map((entry) => this.resolveTemplatesInObject(entry, request, state));
        if (!value || typeof value !== 'object')
            return value;
        return Object.fromEntries(Object.entries(value)
            .map(([key, entry]) => [key, this.resolveTemplatesInObject(entry, request, state)]));
    }
    resolveTemplate(value, request, state) {
        return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
            const resolved = this.lookupTemplateValue(String(expression).trim(), request, state);
            if (resolved === undefined || resolved === null)
                return match;
            return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
        });
    }
    lookupTemplateValue(expression, request, state) {
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
    async writeApiState(requestFile, state, results) {
        await (0, fs_extra_1.ensureDir)(path_1.default.dirname(this.apiStatePath));
        await (0, fs_extra_1.writeFile)(this.apiStatePath, JSON.stringify(this.maskSecrets({
            generatedAt: new Date().toISOString(),
            requestFile: path_1.default.relative(process.cwd(), requestFile),
            values: state.values,
            responses: state.responses,
            results,
        }), null, 2));
    }
    async writeGeneratedApiManifest(requestFile, apiDefinitions) {
        await (0, fs_extra_1.ensureDir)(this.generatedApiDir);
        const baseName = path_1.default.basename(requestFile, path_1.default.extname(requestFile)).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'api';
        const filePath = await this.uniquePath(path_1.default.join(this.generatedApiDir, `${baseName}-api-manifest.json`));
        await (0, fs_extra_1.writeFile)(filePath, JSON.stringify({
            generatedAt: new Date().toISOString(),
            apiDefinitions: this.maskSecrets(apiDefinitions),
        }, null, 2));
        this.logger.info(`ApiAgent: generated API manifest at ${filePath}`);
    }
    maskSecrets(value, keyHint = '') {
        if (Array.isArray(value))
            return value.map((entry) => this.maskSecrets(entry, keyHint));
        if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value)
                .map(([key, entry]) => [key, this.maskSecrets(entry, key)]));
        }
        if (typeof value !== 'string')
            return value;
        if (this.isSecretKey(keyHint))
            return '****';
        if (/^(bearer|basic)\s+[a-z0-9+/=._-]+$/i.test(value))
            return value.replace(/^(\S+)\s+.+$/, '$1 ****');
        return value;
    }
    isSecretKey(key) {
        return /authorization|cookie|token|secret|password|api[-_]?key|client[-_]?secret/i.test(key);
    }
    async uniquePath(filePath) {
        if (!await (0, fs_extra_1.pathExists)(filePath))
            return filePath;
        const dir = path_1.default.dirname(filePath);
        const ext = path_1.default.extname(filePath);
        const base = path_1.default.basename(filePath, ext);
        let index = 2;
        let candidate = path_1.default.join(dir, `${base}_${index}${ext}`);
        while (await (0, fs_extra_1.pathExists)(candidate)) {
            index += 1;
            candidate = path_1.default.join(dir, `${base}_${index}${ext}`);
        }
        return candidate;
    }
}
exports.ApiAgent = ApiAgent;
//# sourceMappingURL=ApiAgent.js.map