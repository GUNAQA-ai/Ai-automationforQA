#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/cli.ts
var import_path10 = __toESM(require("path"));
var import_fs_extra8 = require("fs-extra");

// src/framework/Config.ts
var dotenv = __toESM(require("dotenv"));
var import_path = __toESM(require("path"));

// src/utils/logger.ts
var import_winston = __toESM(require("winston"));
var Logger = class _Logger {
  constructor() {
    const logLevel = process.env.LOG_LEVEL || "info";
    const fileFormat = import_winston.default.format.combine(
      import_winston.default.format.timestamp(),
      import_winston.default.format.printf(({ timestamp, level, message, ...meta }) => {
        const maskedMeta = _Logger.maskSecrets(meta);
        return `${timestamp} [${level}]: ${message} ${Object.keys(maskedMeta).length ? JSON.stringify(maskedMeta) : ""}`;
      })
    );
    const consoleFormat = import_winston.default.format.combine(
      import_winston.default.format.colorize({ all: true }),
      import_winston.default.format.timestamp({ format: "HH:mm:ss" }),
      import_winston.default.format.printf(({ timestamp, level, message, ...meta }) => {
        const maskedMeta = _Logger.maskSecrets(meta);
        const details = Object.keys(maskedMeta).length ? ` ${JSON.stringify(maskedMeta)}` : "";
        return `${timestamp} ${level} ${message}${details}`;
      })
    );
    this.logger = import_winston.default.createLogger({
      level: logLevel,
      format: fileFormat,
      transports: [
        new import_winston.default.transports.Console({ format: consoleFormat }),
        new import_winston.default.transports.File({ filename: "reports/logs/framework.log", format: fileFormat })
      ]
    });
  }
  static getInstance() {
    if (!_Logger.instance) {
      _Logger.instance = new _Logger();
    }
    return _Logger.instance;
  }
  /**
   * Generic log method that forwards to winston.
   */
  log(level, message, meta) {
    this.logger.log(level, message, meta);
  }
  info(message, meta) {
    this.logger.info(message, meta);
  }
  warn(message, meta) {
    this.logger.warn(message, meta);
  }
  error(message, meta) {
    this.logger.error(message, meta);
  }
  /**
   * Masks any key that looks like a secret before logging.
   */
  static maskSecrets(obj = {}) {
    const masked = {};
    for (const [key, value] of Object.entries(obj)) {
      if (/key|secret|token|pwd|password/i.test(key)) {
        masked[key] = "****";
      } else {
        masked[key] = value;
      }
    }
    return masked;
  }
};
var logger_default = Logger;

// src/framework/Config.ts
var Config = class _Config {
  constructor() {
    this.logger = logger_default.getInstance();
    this.env = {};
    const basePath = import_path.default.resolve(process.cwd(), ".env");
    dotenv.config({ path: basePath });
    const envName = process.env.ENVIRONMENT;
    if (envName) {
      const envPath = import_path.default.resolve(process.cwd(), "environments", `${envName}.env`);
      dotenv.config({ path: envPath, override: true });
    }
    Object.assign(this.env, process.env);
    this.validate();
  }
  /** Singleton accessor */
  static get() {
    if (!_Config.instance) {
      _Config.instance = new _Config();
    }
    return _Config.instance;
  }
  /** Get a required variable – throws if missing */
  get(key) {
    const value = this.env[key];
    if (value === void 0) {
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
    const val = this.env["AI_ENABLE"]?.toLowerCase();
    return val !== "false" && val !== "local" && val !== "0";
  }
  /** Get configured provider or 'local' */
  get aiProvider() {
    if (!this.aiEnabled) return "local";
    return this.env["LLM_PROVIDER"]?.toLowerCase() || "groq";
  }
  /** Mask secret values when logging */
  mask(value) {
    if (value.length <= 4) return "****";
    const visible = value.slice(0, 2) + "*".repeat(value.length - 4) + value.slice(-2);
    return visible;
  }
  /** Validate configuration. Missing values are logged because agents can fall back locally. */
  validate() {
    const provider = this.aiProvider;
    if (!this.env["BASE_URL"]) {
      this.logger.warn("BASE_URL is not configured; request applicationUrl or Playwright defaults will be used");
    }
    if (this.aiEnabled) {
      const providerKey = this.env[`${provider.toUpperCase()}_API_KEY`];
      if (!providerKey && provider !== "local") {
        this.logger.warn(`No API key configured for ${provider}; agents will use local fallback behavior when LLM calls fail`);
      }
    }
    const baseUrl = this.env["BASE_URL"];
    this.logger.info("Configuration loaded", {
      BASE_URL: baseUrl ? this.mask(baseUrl) : "not configured",
      AI_ENABLE: this.aiEnabled,
      LLM_PROVIDER: provider
    });
  }
};

// src/agents/planning/PlanningAgent.ts
var import_fs_extra2 = require("fs-extra");
var import_path3 = __toESM(require("path"));
var import_test = require("@playwright/test");

// src/framework/LLMProvider.ts
var import_node_fetch = __toESM(require("node-fetch"));
var LLMProviderFactory = class _LLMProviderFactory {
  static {
    this.logger = logger_default.getInstance();
  }
  static getProvider() {
    const config2 = Config.get();
    if (!config2.aiEnabled || config2.aiProvider === "local") {
      _LLMProviderFactory.logger.info(`AI features disabled. Selecting LocalProvider.`);
      return new LocalProvider();
    }
    const provider = config2.aiProvider;
    _LLMProviderFactory.logger.info(`Selecting LLM provider: ${provider}`);
    const chosenProvider = _LLMProviderFactory.instantiateProvider(provider);
    return new ResilientLLMProvider(chosenProvider);
  }
  static instantiateProvider(provider) {
    switch (provider) {
      case "groq":
        return new GroqProvider();
      case "openai":
        return new OpenAIProvider();
      case "ollama":
        return new OllamaProvider();
      default:
        _LLMProviderFactory.logger.warn(`Unknown LLM provider "${provider}", falling back to LocalProvider`);
        return new LocalProvider();
    }
  }
};
var ResilientLLMProvider = class {
  constructor(primary) {
    this.primary = primary;
  }
  async generate(prompt) {
    try {
      return await this.primary.generate(prompt);
    } catch (err) {
      logger_default.getInstance().warn(`Primary LLM provider failed: ${err.message}. Attempting dynamic fallback...`);
      if (process.env.GROQ_API_KEY && !(this.primary instanceof GroqProvider)) {
        try {
          logger_default.getInstance().info("Falling back to Groq LLM provider...");
          const groq = new GroqProvider();
          return await groq.generate(prompt);
        } catch (groqErr) {
          logger_default.getInstance().warn(`Groq fallback failed: ${groqErr.message}`);
        }
      }
      if (process.env.OPENAI_API_KEY && !(this.primary instanceof OpenAIProvider)) {
        try {
          logger_default.getInstance().info("Falling back to OpenAI LLM provider...");
          const openai = new OpenAIProvider();
          return await openai.generate(prompt);
        } catch (openaiErr) {
          logger_default.getInstance().warn(`OpenAI fallback failed: ${openaiErr.message}`);
        }
      }
      if (!(this.primary instanceof OllamaProvider)) {
        try {
          logger_default.getInstance().info("Falling back to Ollama LLM provider...");
          const ollama = new OllamaProvider();
          return await ollama.generate(prompt);
        } catch (ollamaErr) {
          logger_default.getInstance().warn(`Ollama fallback failed: ${ollamaErr.message}`);
        }
      }
      logger_default.getInstance().warn("All LLM providers failed. Using LocalProvider fallback.");
      return await new LocalProvider().generate(prompt);
    }
  }
};
var LocalProvider = class {
  async generate(prompt) {
    logger_default.getInstance().info("LocalProvider triggered. AI is disabled, returning empty string for LLM prompt.");
    return "";
  }
};
var GroqProvider = class {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    this.endpoint = "https://api.groq.com/openai/v1/chat/completions";
  }
  async generate(prompt) {
    if (!this.apiKey) throw new Error("GROQ_API_KEY not set");
    const body = {
      model: process.env.GROQ_MODEL || process.env.LLM_MODEL || "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
      max_tokens: 4096
    };
    let response = await fetchWithTimeout(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });
    if (response.status === 429) {
      const errorText = await response.clone().text();
      const waitMatch = errorText.match(/try again in ([\d.]+)s/i);
      if (waitMatch) {
        const waitTime = parseFloat(waitMatch[1]) * 1e3 + 1e3;
        logger_default.getInstance().warn(`Groq rate limit reached for ${body.model}. Waiting ${Math.round(waitTime / 1e3)}s before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        response = await fetchWithTimeout(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify(body)
        });
      } else {
        logger_default.getInstance().warn(`Groq rate limit reached but no wait time provided in error message. Error: ${errorText}`);
      }
    }
    await ensureOk(response, "Groq");
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? "";
  }
};
var OpenAIProvider = class {
  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY;
    this.endpoint = process.env.OPENAI_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  }
  async generate(prompt) {
    if (!this.apiKey) throw new Error("OPENAI_API_KEY not set");
    const body = {
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    };
    const response = await fetchWithTimeout(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body)
    });
    await ensureOk(response, "OpenAI");
    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() ?? "";
  }
};
var OllamaProvider = class {
  constructor() {
    this.endpoint = process.env.OLLAMA_ENDPOINT || "http://localhost:11434/api/generate";
  }
  async generate(prompt) {
    const body = {
      model: process.env.OLLAMA_MODEL || "llama3",
      prompt,
      stream: false,
      options: {
        temperature: 0.2
      }
    };
    const response = await fetchWithTimeout(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }, Number(process.env.OLLAMA_TIMEOUT_MS) || 45e3);
    await ensureOk(response, "Ollama");
    const data = await response.json();
    return data?.response?.trim() ?? "";
  }
};
async function fetchWithTimeout(url, options, timeoutMs = 45e3) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (0, import_node_fetch.default)(url, {
      ...options,
      signal: controller.signal
    });
    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}
async function ensureOk(response, provider) {
  if (response.ok) return;
  const body = await response.text();
  throw new Error(`${provider} LLM request failed with ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
}

// src/framework/FrameworkError.ts
var FrameworkError = class _FrameworkError extends Error {
  constructor(message, originalError, code = "FRAMEWORK_ERROR") {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
    this.originalError = originalError;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, _FrameworkError);
    }
  }
};

// src/utils/FrameworkApiExtractor.ts
var import_fs_extra = require("fs-extra");
var import_path2 = __toESM(require("path"));
var FrameworkApiExtractor = class {
  static async extractApiDocs() {
    const srcDir = import_path2.default.resolve(process.cwd(), "src", "framework");
    const filesToExtract = [
      "CommonActions.ts",
      "DataEngine.ts",
      "ApiEngine.ts",
      "WaitHelpers.ts"
    ];
    let combinedApiDoc = "=========================================\nFRAMEWORK API DOCUMENTATION\n=========================================\n\n";
    for (const file of filesToExtract) {
      try {
        const filePath = import_path2.default.join(srcDir, file);
        const fileContent = await (0, import_fs_extra.readFile)(filePath, "utf-8");
        combinedApiDoc += this.parseClassApi(file, fileContent);
      } catch (err) {
      }
    }
    return combinedApiDoc;
  }
  static parseClassApi(fileName, content) {
    let result = `--- File: ${fileName} ---
`;
    const interfaceRegex = /export\s+interface\s+\w+\s*\{[\s\S]*?\n\}/g;
    let match;
    while ((match = interfaceRegex.exec(content)) !== null) {
      result += match[0] + "\n\n";
    }
    const methodRegex = /(\/\*\*[\s\S]*?\*\/)\s*(?:public\s+)?async\s+([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*:\s*Promise<([\s\S]*?)>\s*\{/g;
    let methodMatch;
    let hasMethods = false;
    while ((methodMatch = methodRegex.exec(content)) !== null) {
      hasMethods = true;
      const jsdoc = methodMatch[1];
      const methodName = methodMatch[2];
      const params = methodMatch[3].trim();
      const returnType = methodMatch[4].trim();
      const cleanParams = params.replace(/\s+/g, " ").replace(/,\s*/g, ", ");
      result += `${jsdoc}
async ${methodName}(${cleanParams}): Promise<${returnType}>

`;
    }
    const staticMethodRegex = /(\/\*\*[\s\S]*?\*\/)\s*(?:public\s+)?(?:static\s+)?(?:async\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*:\s*(?:Promise<)?([\s\S]*?)(?:>)?\s*\{/g;
    let staticMatch;
    while ((staticMatch = staticMethodRegex.exec(content)) !== null) {
      const jsdoc = staticMatch[1];
      const methodName = staticMatch[2];
      const params = staticMatch[3].trim();
      const returnType = staticMatch[4].trim();
      if (content.includes(`static ${methodName}`) || content.includes(`static async ${methodName}`)) {
        hasMethods = true;
        const cleanParams = params.replace(/\s+/g, " ").replace(/,\s*/g, ", ");
        result += `${jsdoc}
static ${methodName}(${cleanParams}): ${returnType}

`;
      }
    }
    return result + "\n";
  }
};

// src/agents/planning/PlanningAgent.ts
var PlanningAgent = class {
  constructor() {
    this.logger = logger_default.getInstance();
    this.storageDir = import_path3.default.resolve("storage", "plans");
    this.promptPath = import_path3.default.resolve("prompts", "planning.txt");
  }
  async run(requestFile) {
    try {
      const raw = await (0, import_fs_extra2.readFile)(requestFile, "utf-8");
      const req = this.parseRequirement(raw, requestFile);
      const normalizedReq = this.normalizeRequestShape({
        ...req,
        testData: this.mergeCredentialsIntoTestData(req),
        locators: this.normalizeLocatorAliases(req.locators)
      });
      if (this.hasTestCaseCollection(normalizedReq)) {
        return this.writeSuitePlan(normalizedReq);
      }
      const reusablePlan = await this.findMatchingRequestPlan(normalizedReq);
      if (reusablePlan) {
        this.logger.info(`PlanningAgent: reusing existing plan ${reusablePlan}`);
        return reusablePlan;
      }
      return this.writePlan(await this.buildPlan(normalizedReq));
    } catch (err) {
      this.logger.error("PlanningAgent failed", { error: err });
      throw new FrameworkError("Planning failed", err);
    }
  }
  normalizeRequestShape(req) {
    const scenarioSource = req.requirement ?? req.scenario ?? req.testName ?? "UnnamedScenario";
    const requirementItems = this.filterRelevantRequirements(this.requirementItems(scenarioSource), req);
    const normalizedRequirement = Array.isArray(req.requirement) ? requirementItems.length === 1 ? requirementItems[0] : requirementItems : req.requirement;
    const scenario = this.scenarioText(req.scenario ?? normalizedRequirement ?? req.testName, "UnnamedScenario");
    return {
      ...req,
      requirement: normalizedRequirement,
      scenario,
      requirements: requirementItems.length > 1 ? requirementItems : req.requirements
    };
  }
  async buildPlan(req, overrides = {}) {
    const { steps: rawSteps, locators: newLocators } = await this.createSteps(JSON.stringify(req, null, 2), req);
    const preconditions = await this.resolvePreconditions(req);
    const setupSteps = this.inlinePreconditionSteps(preconditions, rawSteps);
    const steps = this.reindexSteps([...setupSteps, ...rawSteps]);
    const scenario = this.scenarioText(req.requirement ?? req.scenario ?? req.testName, "UnnamedScenario");
    const requirements = this.requirementItems(req.requirements ?? req.requirement ?? req.scenario ?? req.testName);
    const plan = {
      scenario,
      steps,
      env: req.environment ?? "default",
      applicationUrl: req.applicationUrl ?? process.env.BASE_URL,
      priority: this.readPriority(req, 100),
      dependsOn: this.normalizeDependsOn(req.dependsOn ?? req.dependencies),
      ...overrides
    };
    if (requirements.length > 1) {
      plan.requirements = requirements;
    }
    if (setupSteps.length > 0) {
      plan.setupSteps = setupSteps;
    }
    const mergedLocators = { ...req.locators ?? {}, ...newLocators ?? {} };
    if (Object.keys(mergedLocators).length > 0) {
      this.logger.info(`PlanningAgent: validating ${Object.keys(mergedLocators).length} locators against DOM`);
      plan.locators = await this.validateLocatorsAgainstDom(plan.applicationUrl, mergedLocators);
    }
    if (req.testData && typeof req.testData === "object") {
      plan.testData = req.testData;
    }
    if (preconditions.length > 0) {
      plan.preconditions = preconditions;
      plan.executionOrder = [
        ...preconditions.slice().sort((a, b) => a.priority - b.priority).map((precondition) => ({
          type: "precondition",
          key: precondition.key,
          priority: precondition.priority,
          optional: precondition.optional,
          planPath: precondition.planPath
        })),
        { type: "main", scenario: plan.scenario, priority: plan.priority }
      ];
    }
    return plan;
  }
  async writePlan(plan) {
    await (0, import_fs_extra2.ensureDir)(this.storageDir);
    const existingPlan = await this.findMatchingPlan(plan);
    if (existingPlan) {
      this.logger.info(`PlanningAgent: reusing existing plan ${existingPlan}`);
      return existingPlan;
    }
    const planPath = await this.nextPlanPath(this.safeFileBase(plan.scenario));
    await (0, import_fs_extra2.writeFile)(planPath, JSON.stringify(plan, null, 2));
    this.logger.info(`Plan written to ${planPath}`);
    return planPath;
  }
  async writeSuitePlan(req) {
    const testCases = this.extractTestCaseRequests(req).sort((a, b) => this.readPriority(a, 100) - this.readPriority(b, 100));
    const plannedCases = [];
    for (const [index, testCase] of testCases.entries()) {
      const testCaseKey = String(testCase.key ?? testCase.id ?? `testCase${index + 1}`);
      const plan = await this.buildPlan(testCase, {
        testCase: true,
        testCaseKey,
        parentScenario: this.scenarioText(req.requirement ?? req.scenario, "Generated suite")
      });
      const planPath = await this.writePlan(plan);
      plannedCases.push({
        key: testCaseKey,
        scenario: this.scenarioText(plan.scenario, `Test case ${index + 1}`),
        priority: Number(plan.priority ?? this.readPriority(testCase, index + 1)),
        planPath,
        dependsOn: this.normalizeDependsOn(testCase.dependsOn ?? testCase.dependencies)
      });
    }
    const orderedCases = this.orderByPriorityAndDependencies(plannedCases);
    const suiteScenario = this.scenarioText(req.testName ?? req.scenario ?? "TestSuite", "Generated suite") + " Master Suite";
    const suitePlan = {
      suite: true,
      scenario: suiteScenario,
      steps: [],
      env: req.environment ?? "default",
      applicationUrl: req.applicationUrl ?? process.env.BASE_URL,
      priority: this.readPriority(req, 0),
      testCases: orderedCases,
      executionOrder: orderedCases.map((testCase) => ({
        type: "testCase",
        key: testCase.key,
        scenario: testCase.scenario,
        priority: testCase.priority,
        dependsOn: testCase.dependsOn,
        planPath: testCase.planPath
      }))
    };
    if (Object.keys(req.locators ?? {}).length > 0) {
      suitePlan.locators = req.locators;
    }
    if (req.testData && typeof req.testData === "object") {
      suitePlan.testData = req.testData;
    }
    return this.writePlan(suitePlan);
  }
  hasTestCaseCollection(req) {
    const keys = ["testCases", "testcases", "tests", "scenarios", "flows"];
    for (const key of keys) {
      if (Array.isArray(req[key]) && req[key].length > 0) {
        if (typeof req[key][0] === "object") return true;
      }
    }
    return false;
  }
  extractTestCaseRequests(req) {
    const collection = req.testCases ?? req.testcases ?? req.tests ?? req.scenarios ?? req.flows ?? (Array.isArray(req.requirements) ? req.requirements : Array.isArray(req.requirement) ? req.requirement : []);
    const items = (Array.isArray(collection) ? collection : []).map((item, index) => this.normalizeTestCaseItem(item, req, index)).filter(Boolean);
    for (let i = 1; i < items.length; i++) {
      if (items[i - 1].requirement.toLowerCase().includes("precondition")) {
        items[i - 1].precondition = true;
        if (!items[i].dependsOn) items[i].dependsOn = [];
        if (!items[i].dependsOn.includes(items[i - 1].key)) {
          items[i].dependsOn.push(items[i - 1].key);
        }
      }
    }
    if (items.length > 0 && items[0].requirement.toLowerCase().includes("precondition")) {
      items[0].precondition = true;
    }
    return items;
  }
  normalizeTestCaseItem(item, parentReq, index) {
    const record = typeof item === "string" ? { requirement: item } : item && typeof item === "object" ? item : {};
    const requirement = this.scenarioText(
      record.requirement ?? record.scenario ?? record.name ?? record.testName ?? record.description ?? `Test case ${index + 1}`,
      `Test case ${index + 1}`
    );
    return {
      ...record,
      key: record.key ?? record.id ?? this.derivePreconditionKey(requirement) ?? `testCase${index + 1}`,
      requirement,
      applicationUrl: record.applicationUrl ?? parentReq.applicationUrl ?? process.env.BASE_URL,
      environment: record.environment ?? parentReq.environment ?? "default",
      priority: this.readPriority(record, index + 1),
      testData: {
        ...parentReq.credentials ?? {},
        ...parentReq.testData ?? {},
        ...record.credentials ?? {},
        ...record.testData ?? {}
      },
      locators: this.normalizeLocatorAliases({
        ...parentReq.locators ?? {},
        ...record.locators ?? {}
      }),
      preconditions: record.preconditions ?? record.preConditions ?? parentReq.preconditions ?? parentReq.preConditions,
      preSteps: record.preSteps ?? record.presteps ?? parentReq.preSteps ?? parentReq.presteps,
      setup: record.setup ?? parentReq.setup,
      dependsOn: record.dependsOn ?? record.dependencies,
      dependencies: record.dependencies
    };
  }
  scenarioText(value, fallback = "UnnamedScenario") {
    const items = this.requirementItems(value);
    if (items.length) return items.join(" ");
    return fallback;
  }
  requirementItems(value) {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.requirementItems(entry));
    }
    if (typeof value === "string") {
      const trimmed = value.replace(/\s+/g, " ").trim();
      return trimmed ? [trimmed] : [];
    }
    if (value && typeof value === "object") {
      const record = value;
      return this.requirementItems(
        record.requirement ?? record.scenario ?? record.name ?? record.testName ?? record.description ?? record.objective ?? this.stableStringify(record)
      );
    }
    if (value === void 0 || value === null) return [];
    const text = String(value).replace(/\s+/g, " ").trim();
    return text ? [text] : [];
  }
  filterRelevantRequirements(requirements, req) {
    if (requirements.length <= 1) return requirements;
    const context = this.requestUiContext(req);
    const filtered = requirements.filter((requirement) => this.requirementMatchesPageContext(requirement, context));
    if (filtered.length > 0 && filtered.length < requirements.length) {
      this.logger.info(`PlanningAgent: removed ${requirements.length - filtered.length} requirement(s) that did not match the available page context`);
      return filtered;
    }
    return requirements;
  }
  requestUiContext(req) {
    const locators = this.normalizeLocatorAliases(req.locators);
    const locatorText = Object.entries(locators).map(([key, value]) => `${key} ${value}`).join(" ");
    const testData = req.testData && typeof req.testData === "object" ? req.testData : {};
    const testDataText = Object.entries(testData).map(([key, value]) => `${key} ${String(value)}`).join(" ");
    const stepText = Array.isArray(req.steps) ? req.steps.map((step) => `${step?.action ?? ""} ${step?.target ?? ""} ${step?.value ?? ""} ${step?.expectedResult ?? ""}`).join(" ") : "";
    return this.locatorSearchText(`${req.applicationUrl ?? ""} ${req.environment ?? ""} ${locatorText}`, `${testDataText} ${stepText}`);
  }
  requirementMatchesPageContext(requirement, context) {
    if (/page\s+loads?|ui|visible|displayed|redirect|url|login\s+page|screen/i.test(requirement)) return true;
    if (/logout|log\s*out|sign\s*out/i.test(requirement)) return /logout|log\s*out|sign\s*out|login|user|session/.test(context);
    if (/login|log\s*in|sign\s*in/i.test(requirement)) return /login|log\s*in|sign\s*in|user|email|password|submit/.test(context);
    const genericWords = /* @__PURE__ */ new Set([
      "verify",
      "valid",
      "invalid",
      "success",
      "successfully",
      "without",
      "using",
      "should",
      "must",
      "page",
      "loads",
      "load",
      "issue",
      "issues",
      "user"
    ]);
    const specificWords = this.significantWords(requirement).filter((word) => !genericWords.has(word));
    if (!specificWords.length) return true;
    return specificWords.some((word) => context.includes(word));
  }
  orderByPriorityAndDependencies(items) {
    const remaining = [...items].sort((a, b) => a.priority - b.priority);
    const ordered = [];
    const emitted = /* @__PURE__ */ new Set();
    while (remaining.length) {
      const nextIndex = remaining.findIndex((item) => item.dependsOn.every((dependency) => emitted.has(this.normalizeKey(dependency))));
      const index = nextIndex >= 0 ? nextIndex : 0;
      const [next] = remaining.splice(index, 1);
      ordered.push(next);
      emitted.add(this.normalizeKey(next.key));
    }
    return ordered;
  }
  async nextPlanPath(baseName) {
    const maxPlanBaseLength = 50;
    const shortBaseName = this.compactFileBase([baseName], maxPlanBaseLength);
    return import_path3.default.join(this.storageDir, `${shortBaseName}Plan.json`);
  }
  safeFileBase(value) {
    const words = String(value || "UnnamedScenario").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
    const stopWords = /* @__PURE__ */ new Set([
      "automation",
      "verification",
      "verify",
      "user",
      "can",
      "to",
      "successfully",
      "using",
      "email",
      "password",
      "page",
      "loads",
      "load",
      "without",
      "ui",
      "issues",
      "issue",
      "redirects",
      "redirect",
      "back",
      "navigate",
      "site",
      "valid",
      "credentials",
      "shown",
      "after",
      "with",
      "the",
      "and",
      "then",
      "regression",
      "complete",
      "details"
    ]);
    const significant = words.filter((word) => !stopWords.has(word.toLowerCase()));
    const selected = this.hasWords(words, ["automation", "demo", "full"]) ? ["Demo", "Full"] : significant[0]?.toLowerCase() === "login" && significant[1]?.toLowerCase() === "flow" ? significant.slice(0, 2) : significant.slice(0, 3);
    return this.compactFileBase(selected.length ? selected : words.slice(0, 2), 12) || "Unnamed";
  }
  compactFileBase(words, maxLength) {
    const safeMaxLength = Math.max(1, maxLength);
    const normalizedWords = words.flatMap((word) => String(word).replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[a-zA-Z0-9]+/g) ?? []).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    let output = "";
    for (const word of normalizedWords) {
      if (!output) {
        output = word.slice(0, safeMaxLength);
        continue;
      }
      if (output.length + word.length > safeMaxLength) continue;
      output += word;
    }
    return output || "Unnamed".slice(0, safeMaxLength);
  }
  hasWords(words, expectedWords) {
    const normalizedWords = new Set(words.map((word) => word.toLowerCase()));
    return expectedWords.every((word) => normalizedWords.has(word));
  }
  async resolvePreconditions(req) {
    const preconditionRequests = this.collectPreconditionRequests(req).sort((a, b) => a.priority - b.priority);
    const planned = [];
    const seenKeys = /* @__PURE__ */ new Set();
    for (const precondition of preconditionRequests) {
      const normalizedKey = this.normalizeKey(precondition.key);
      if (!normalizedKey || seenKeys.has(normalizedKey)) continue;
      seenKeys.add(normalizedKey);
      const existingPlan = await this.findPlanForPrecondition(precondition);
      if (existingPlan) {
        const existingSetupSteps = await this.readPlanSteps(existingPlan);
        planned.push({
          key: precondition.key,
          requirement: precondition.requirement,
          source: precondition.source,
          status: "existing",
          planPath: existingPlan,
          inline: precondition.inline,
          priority: precondition.priority,
          optional: precondition.optional,
          dependsOn: precondition.dependsOn,
          setupSteps: existingSetupSteps
        });
        continue;
      }
      const { steps, locators: preLocators } = await this.createSteps(JSON.stringify(precondition.request, null, 2), precondition.request);
      const plan = {
        scenario: precondition.requirement,
        steps,
        env: precondition.request.environment ?? req.environment ?? "default",
        applicationUrl: precondition.request.applicationUrl ?? req.applicationUrl ?? process.env.BASE_URL,
        precondition: true,
        preconditionKey: precondition.key,
        priority: precondition.priority,
        optional: precondition.optional,
        dependsOn: precondition.dependsOn
      };
      const mergedLocators = { ...precondition.request.locators ?? {}, ...preLocators ?? {} };
      if (Object.keys(mergedLocators).length > 0) {
        this.logger.info(`PlanningAgent: validating ${Object.keys(mergedLocators).length} locators against DOM for precondition ${precondition.key}`);
        plan.locators = await this.validateLocatorsAgainstDom(plan.applicationUrl, mergedLocators);
      }
      if (precondition.request.testData && typeof precondition.request.testData === "object") {
        plan.testData = precondition.request.testData;
      }
      const planPath = await this.writePlan(plan);
      planned.push({
        key: precondition.key,
        requirement: precondition.requirement,
        source: precondition.source,
        status: "created",
        planPath,
        inline: precondition.inline,
        priority: precondition.priority,
        optional: precondition.optional,
        dependsOn: precondition.dependsOn,
        setupSteps: steps
      });
    }
    return planned;
  }
  inlinePreconditionSteps(preconditions, mainSteps) {
    const existingText = this.stepsSearchText(mainSteps);
    return preconditions.filter((precondition) => precondition.inline !== false).sort((a, b) => a.priority - b.priority).flatMap((precondition) => (precondition.setupSteps ?? []).filter((step) => !this.isDuplicateSetupStep(step, existingText)).map((step) => ({
      ...step,
      preconditionKey: precondition.key,
      source: "inlinePrecondition",
      optional: step.optional ?? precondition.optional
    })));
  }
  isDuplicateSetupStep(step, existingText) {
    const action = this.normalizeKey(String(step?.action ?? ""));
    const target = this.normalizeKey(String(step?.target ?? ""));
    if (!action || !target) return false;
    return existingText.includes(`${action}:${target}`);
  }
  stepsSearchText(steps) {
    return steps.map((step) => `${this.normalizeKey(String(step?.action ?? ""))}:${this.normalizeKey(String(step?.target ?? ""))}`).join(" ");
  }
  async readPlanSteps(planPath) {
    try {
      const plan = JSON.parse(await (0, import_fs_extra2.readFile)(planPath, "utf-8"));
      return Array.isArray(plan.steps) ? plan.steps : [];
    } catch {
      return [];
    }
  }
  collectPreconditionRequests(req) {
    const requests = [
      ...this.normalizePreconditionCollection(req.preconditions, req, "preconditions"),
      ...this.normalizePreconditionCollection(req.preConditions, req, "preConditions"),
      ...this.normalizePreconditionCollection(req.preSteps, req, "preSteps"),
      ...this.normalizePreconditionCollection(req.presteps, req, "presteps"),
      ...this.normalizePreconditionCollection(req.dependsOn, req, "dependsOn"),
      ...this.normalizePreconditionCollection(req.dependencies, req, "dependencies"),
      ...this.normalizePreconditionCollection(req.setup, req, "setup")
    ];
    return requests;
  }
  normalizePreconditionCollection(value, parentReq, source) {
    if (value === void 0 || value === null || value === false) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => this.normalizePreconditionItem(item, parentReq, source));
  }
  normalizePreconditionItem(item, parentReq, source) {
    if (typeof item === "string") {
      const requirement2 = item.trim();
      if (!requirement2) return [];
      return [this.createPreconditionRequest(requirement2, {}, parentReq, source)];
    }
    if (!item || typeof item !== "object") return [];
    const record = item;
    const requirement = String(
      record.requirement ?? record.scenario ?? record.name ?? record.objective ?? record.description ?? record.testName ?? ""
    ).trim();
    if (!requirement) return [];
    return [this.createPreconditionRequest(requirement, record, parentReq, source)];
  }
  createPreconditionRequest(requirement, item, parentReq, source) {
    const request = {
      ...item,
      applicationUrl: item.applicationUrl ?? parentReq.applicationUrl ?? process.env.BASE_URL,
      environment: item.environment ?? parentReq.environment ?? "default",
      requirement,
      testData: this.mergePreconditionTestData(parentReq.testData, item.testData),
      locators: this.normalizeLocatorAliases({
        ...parentReq.locators ?? {},
        ...item.locators ?? {}
      })
    };
    return {
      key: String(item.key ?? item.type ?? this.derivePreconditionKey(requirement)),
      requirement,
      source,
      inline: item.inline !== false,
      priority: this.readPriority(item, this.defaultPreconditionPriority(requirement)),
      optional: Boolean(item.optional ?? item.continueOnFailure),
      dependsOn: this.normalizeDependsOn(item.dependsOn ?? item.dependencies),
      request
    };
  }
  mergePreconditionTestData(parentTestData, preconditionTestData) {
    const parent = parentTestData && typeof parentTestData === "object" ? parentTestData : {};
    const own = preconditionTestData && typeof preconditionTestData === "object" ? preconditionTestData : {};
    return { ...parent, ...own };
  }
  mergeCredentialsIntoTestData(req) {
    const credentials = req.credentials && typeof req.credentials === "object" ? req.credentials : {};
    const testData = req.testData && typeof req.testData === "object" ? req.testData : {};
    return { ...credentials, ...testData };
  }
  defaultPreconditionPriority(requirement) {
    return 50;
  }
  derivePreconditionKey(requirement) {
    const words = this.significantWords(requirement).slice(0, 4);
    if (!words.length) return "precondition";
    return words.map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)).join("");
  }
  async findPlanForPrecondition(precondition) {
    const plans = await this.readStoredPlans();
    return plans.find(({ plan }) => this.planMatchesPrecondition(plan, precondition))?.file;
  }
  planMatchesPrecondition(plan, precondition) {
    if (!this.applicationUrlsMatch(this.planApplicationUrl(plan), precondition.request.applicationUrl)) {
      return false;
    }
    const scenario = this.scenarioText(plan.scenario ?? plan.testName, "");
    const expectedWords = this.significantWords(precondition.requirement);
    const scenarioText = this.locatorSearchText(scenario, "");
    const matchedWords = expectedWords.filter((word) => scenarioText.includes(word));
    return expectedWords.length > 0 && matchedWords.length >= Math.min(2, expectedWords.length);
  }
  async findMatchingRequestPlan(req) {
    const fingerprint = this.requestFingerprint(req);
    const plans = await this.readStoredPlans();
    return plans.find(({ file, plan }) => !plan.suite && !plan.precondition && !plan.testCase && this.requestFingerprint(plan) === fingerprint && this.isShortPlanFileName(file))?.file;
  }
  requestFingerprint(value) {
    return this.stableStringify({
      scenario: this.scenarioText(value.requirement ?? value.scenario ?? value.testName ?? ""),
      env: value.env ?? value.environment ?? "default",
      applicationUrl: this.planApplicationUrl(value),
      locators: this.normalizeLocatorAliases(value.locators),
      testData: value.testData ?? {},
      dependsOn: this.normalizeDependsOn(value.dependsOn ?? value.dependencies)
    });
  }
  async findMatchingPlan(plan) {
    const fingerprint = this.planFingerprint(plan);
    const expectedPrefix = this.compactFileBase([this.safeFileBase(this.scenarioText(plan.scenario ?? plan.testName, ""))], 50);
    const plans = await this.readStoredPlans();
    return plans.find(({ file, plan: existingPlan }) => this.planFingerprint(existingPlan) === fingerprint && this.isShortPlanFileName(file) && this.isExpectedPlanFileName(file, expectedPrefix))?.file;
  }
  isShortPlanFileName(file) {
    return import_path3.default.basename(file).length <= 16;
  }
  isExpectedPlanFileName(file, expectedPrefix) {
    const escapedPrefix = expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escapedPrefix}(?:_\\d+)?Plan\\.json$`).test(import_path3.default.basename(file));
  }
  async readStoredPlans() {
    if (!await (0, import_fs_extra2.pathExists)(this.storageDir)) return [];
    const entries = await (0, import_fs_extra2.readdir)(this.storageDir);
    const plans = [];
    for (const entry of entries.filter((name) => name.endsWith(".json"))) {
      const file = import_path3.default.join(this.storageDir, entry);
      try {
        const plan = JSON.parse(await (0, import_fs_extra2.readFile)(file, "utf-8"));
        if (plan && typeof plan === "object") plans.push({ file, plan });
      } catch {
        this.logger.warn(`PlanningAgent: ignoring unreadable plan ${file}`);
      }
    }
    return plans;
  }
  planFingerprint(plan) {
    return this.stableStringify({
      scenario: this.scenarioText(plan.scenario ?? plan.testName ?? ""),
      env: plan.env ?? plan.environment ?? "default",
      applicationUrl: this.planApplicationUrl(plan),
      steps: Array.isArray(plan.steps) ? plan.steps : [],
      locators: plan.locators ?? {},
      testData: plan.testData ?? {},
      precondition: Boolean(plan.precondition),
      preconditionKey: plan.preconditionKey ?? "",
      suite: Boolean(plan.suite),
      testCase: Boolean(plan.testCase),
      priority: plan.priority ?? 100,
      dependsOn: plan.dependsOn ?? [],
      executionOrder: plan.executionOrder ?? []
    });
  }
  planApplicationUrl(plan) {
    return String(plan.applicationUrl ?? this.inferApplicationUrlFromSteps(plan.steps) ?? "").trim();
  }
  applicationUrlsMatch(left, right) {
    const leftUrl = String(left ?? "").trim();
    const rightUrl = String(right ?? "").trim();
    if (!leftUrl || !rightUrl) return true;
    try {
      return new URL(leftUrl).origin === new URL(rightUrl).origin;
    } catch {
      return leftUrl === rightUrl;
    }
  }
  inferApplicationUrlFromSteps(steps) {
    if (!Array.isArray(steps)) return void 0;
    for (const step of steps) {
      if (String(step?.action ?? "").toLowerCase() !== "navigate") continue;
      const url = [step?.value, step?.target].map((value) => String(value ?? "").trim()).find((value) => /^https?:\/\//i.test(value));
      if (url) return url;
    }
    return void 0;
  }
  stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const record = value;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  parseRequirement(raw, requestFile) {
    try {
      return JSON.parse(raw);
    } catch {
      const fileName = import_path3.default.basename(requestFile, import_path3.default.extname(requestFile));
      this.logger.warn(`Requirement file is not JSON; treating ${requestFile} as plain-text requirement`);
      return {
        applicationUrl: process.env.BASE_URL,
        environment: process.env.ENVIRONMENT ?? "default",
        requirement: raw.trim() || fileName.replace(/[-_]+/g, " "),
        testData: {}
      };
    }
  }
  async createSteps(rawRequest, req) {
    if (Array.isArray(req.steps) && req.steps.length) {
      this.logger.info(`PlanningAgent: using ${req.steps.length} explicit requirement step(s) from request`);
      return { steps: this.normalizeSteps(req.steps), locators: req.locators };
    }
    let domLocators = {};
    if (!req.locators || Object.keys(req.locators).length === 0) {
      const appUrl = req.applicationUrl || process.env.BASE_URL;
      if (appUrl) {
        if (!Config.get().aiEnabled) {
          this.logger.info(`PlanningAgent: AI is disabled. Scraping local heuristic locators from ${appUrl}`);
          domLocators = await this.fetchLocalHeuristicLocators(appUrl, req);
          req.locators = domLocators;
        }
      }
    }
    try {
      if (!Config.get().aiEnabled) {
        throw new FrameworkError("AI features are disabled (AI_ENABLE=false)", void 0, "PLAN_AI_DISABLED");
      }
      let domContext = "";
      if (!req.locators || Object.keys(req.locators).length === 0) {
        const appUrl = req.applicationUrl || process.env.BASE_URL;
        if (appUrl) {
          this.logger.info(`PlanningAgent: No locators provided. Fetching DOM context for ${appUrl}`);
          domContext = await this.fetchDomContext(appUrl);
        }
      }
      const template = await (0, import_fs_extra2.readFile)(this.promptPath, "utf-8");
      const frameworkApiDoc = await FrameworkApiExtractor.extractApiDocs();
      const prompt = template.replace("{{REQUEST_JSON}}", rawRequest).replace("{{DOM_CONTEXT}}", domContext).replace("{{FRAMEWORK_API}}", frameworkApiDoc);
      this.logger.info(`PlanningAgent: using prompt template ${this.promptPath}`);
      const output = await LLMProviderFactory.getProvider().generate(prompt);
      const parsed = this.parseStepsOutput(output);
      if (parsed.steps.length) {
        this.logger.info(`PlanningAgent: accepted prompt output with ${parsed.steps.length} steps`);
        return parsed;
      }
      this.logger.warn("PlanningAgent: prompt output was empty or invalid JSON; using local fallback plan");
    } catch (err) {
      this.logger.warn("PlanningAgent: prompt execution failed; using local fallback plan", { error: err });
    }
    this.logger.info("PlanningAgent: local fallback preserves provided locators and uses semantic names when locators are missing");
    return { steps: this.createFallbackSteps(req) };
  }
  parseStepsOutput(output) {
    const cleaned = this.cleanJsonOutput(output);
    if (!cleaned) return { steps: [] };
    try {
      const parsed = JSON.parse(cleaned);
      const steps = Array.isArray(parsed) ? parsed : parsed.steps;
      const normalizedSteps = Array.isArray(steps) ? this.normalizeSteps(steps) : [];
      return { steps: normalizedSteps, locators: parsed.locators };
    } catch {
      return { steps: [] };
    }
  }
  async fetchDomContext(url) {
    let browser;
    try {
      browser = await import_test.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
      await page.evaluate(`
        document.querySelectorAll('script, style, svg, noscript').forEach(el => el.remove());
      `);
      const html = await page.content();
      return html;
    } catch (err) {
      this.logger.warn(`PlanningAgent: failed to fetch DOM from ${url}`, { error: err });
      return "";
    } finally {
      if (browser) await browser.close();
    }
  }
  async validateLocatorsAgainstDom(url, locators) {
    if (!url) return locators;
    let browser;
    const validatedLocators = {};
    try {
      browser = await import_test.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
      for (const [key, selector] of Object.entries(locators)) {
        try {
          const count = await page.locator(selector).count();
          if (count > 0) {
            validatedLocators[key] = selector;
          } else {
            this.logger.warn(`PlanningAgent: Locator '${key}' was not found in the DOM immediately, but keeping it for ExecutionAgent to handle: ${selector}`);
            validatedLocators[key] = selector;
          }
        } catch (err) {
          this.logger.warn(`PlanningAgent: Error validating locator '${key}', keeping it for ExecutionAgent: ${selector}`);
          validatedLocators[key] = selector;
        }
      }
      return validatedLocators;
    } catch (err) {
      this.logger.warn(`PlanningAgent: failed to validate locators on ${url}`, { error: err });
      return locators;
    } finally {
      if (browser) await browser.close();
    }
  }
  async fetchLocalHeuristicLocators(url, req) {
    let browser;
    const discoveredLocators = {};
    try {
      browser = await import_test.chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 3e4 });
      const elements = await page.evaluate(`
        (() => {
          const els = document.querySelectorAll('input, select, textarea, button, a, [role="button"], [role="link"], [role="checkbox"]');
          return Array.from(els).map(el => {
            const tag = el.tagName.toLowerCase();
            const id = el.id;
            const name = el.getAttribute('name') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const text = el.textContent ? el.textContent.trim() : '';
            const type = el.getAttribute('type') || '';
            
            let selector = tag;
            if (id) selector += '#' + id;
            else if (name) selector += '[name="' + name + '"]';
            else if (placeholder) selector += '[placeholder="' + placeholder + '"]';
            else if (ariaLabel) selector += '[aria-label="' + ariaLabel + '"]';
            
            return { tag, id, name, placeholder, ariaLabel, text, type, selector };
          });
        })()
      `);
      const keywordsToFind = /* @__PURE__ */ new Set();
      if (req.testData) {
        Object.keys(req.testData).forEach((k) => keywordsToFind.add(k.toLowerCase()));
      }
      const reqText = this.scenarioText(req.requirement ?? req.scenario, "").toLowerCase();
      const words = reqText.split(/\s+/);
      for (const word of words) {
        const cleanWord = word.replace(/[^a-z0-9]/g, "");
        if (cleanWord.length > 3 && !["with", "then", "that", "this", "verify", "assert", "check"].includes(cleanWord)) {
          keywordsToFind.add(cleanWord);
        }
      }
      for (const keyword of keywordsToFind) {
        const match = elements.find(
          (el) => el.id.toLowerCase().includes(keyword) || el.name.toLowerCase().includes(keyword) || el.placeholder.toLowerCase().includes(keyword) || el.ariaLabel.toLowerCase().includes(keyword) || el.text.toLowerCase().includes(keyword) && el.text.length > 0 && el.text.length < 50
        );
        if (match && match.selector) {
          if (!match.selector.includes(":")) {
            discoveredLocators[keyword] = match.selector;
          }
        }
      }
      this.logger.info(`PlanningAgent: Local heuristic scraper found ${Object.keys(discoveredLocators).length} locators`);
      return discoveredLocators;
    } catch (err) {
      this.logger.warn(`PlanningAgent: Local heuristic scraper failed on ${url}`, { error: err });
      return {};
    } finally {
      if (browser) await browser.close();
    }
  }
  cleanJsonOutput(output) {
    const trimmed = output.trim();
    const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return (fenced ? fenced[1] : trimmed).trim();
  }
  createFallbackSteps(req) {
    if (Array.isArray(req.steps) && req.steps.length) {
      return this.normalizeSteps(req.steps);
    }
    const locators = { ...req.locators ?? {} };
    const testData = req.testData ?? {};
    const requirementParts = (Array.isArray(req.requirement) ? req.requirement : Array.isArray(req.requirements) ? req.requirements : [req.requirement ?? req.scenario ?? ""]).flatMap(
      (part) => String(part).split(/(?:,|\band\b|then|;)+/i).map((p) => p.trim()).filter(Boolean)
    );
    const globalSteps = [];
    const usedKeys = /* @__PURE__ */ new Set();
    const usedTargets = /* @__PURE__ */ new Set();
    if (req.applicationUrl || process.env.BASE_URL) {
      globalSteps.push({
        action: "navigate",
        target: "applicationUrl",
        value: req.applicationUrl ?? process.env.BASE_URL
      });
      usedKeys.add("applicationUrl");
      usedTargets.add("applicationUrl");
    }
    const hasLoginReq = requirementParts.some((part) => /login|log\s*in|signin|sign\s*in/i.test(String(part).toLowerCase()));
    if (hasLoginReq) {
      if (!locators.emailField && !locators.loginEmailField) {
        locators.emailField = "//input[@id='email']";
      }
      if (!locators.passwordField && !locators.loginPasswordField) {
        locators.passwordField = "//input[@id='password']";
      }
      if (!locators.signInButton && !locators.loginButton) {
        locators.signInButton = "//button[text()=' Sign In ']";
      }
      req.locators = locators;
      globalSteps.push({
        action: "fill",
        target: "emailField",
        value: testData.loginEmail ?? testData.email ?? "admin"
      });
      globalSteps.push({
        action: "fill",
        target: "passwordField",
        value: testData.loginPassword ?? testData.password ?? "admin"
      });
      globalSteps.push({
        action: "click",
        target: "signInButton"
      });
      usedTargets.add("emailField");
      usedTargets.add("passwordField");
      usedTargets.add("signInButton");
    }
    for (const part of requirementParts) {
      const partText = String(part).toLowerCase();
      if (!partText.trim() || /login|log\s*in|signin|sign\s*in/i.test(partText)) continue;
      if (/api|http|post|get|put|delete/i.test(partText)) {
        globalSteps.push({
          action: "api",
          method: partText.includes("post") ? "POST" : partText.includes("delete") ? "DELETE" : "GET",
          url: "/api/v1/resource",
          expectedStatus: 200
        });
        continue;
      }
      if (/database|query|db|sql/i.test(partText)) {
        globalSteps.push({
          action: "db",
          query: "SELECT * FROM users LIMIT 1;"
        });
        continue;
      }
      if (/pdf/i.test(partText)) {
        globalSteps.push({
          action: "validatepdf",
          value: "downloads/document.pdf"
        });
        continue;
      }
      if (/excel|xlsx/i.test(partText)) {
        globalSteps.push({
          action: "validateexcel",
          value: "downloads/report.xlsx"
        });
        continue;
      }
      if (/zip/i.test(partText)) {
        globalSteps.push({
          action: "validatezip",
          value: "downloads/archive.zip"
        });
        continue;
      }
      if (/download/i.test(partText)) {
        globalSteps.push({
          action: "downloadfile",
          target: "downloadButton",
          value: "downloads"
        });
        if (!locators.downloadButton) locators.downloadButton = "//button[contains(text(),'Download')]";
        continue;
      }
      if (/upload|attach/i.test(partText)) {
        globalSteps.push({
          action: "uploadfile",
          target: "uploadInput",
          value: "storage/sample.txt"
        });
        if (!locators.uploadInput) locators.uploadInput = "//input[@type='file']";
        continue;
      }
      if (/hover/i.test(partText)) {
        globalSteps.push({
          action: "hover",
          target: "menuItem"
        });
        if (!locators.menuItem) locators.menuItem = "//a[contains(text(),'Menu')]";
        continue;
      }
      if (/scroll/i.test(partText)) {
        globalSteps.push({
          action: "scroll",
          target: "pageFooter"
        });
        if (!locators.pageFooter) locators.pageFooter = "footer";
        continue;
      }
      if (/alert|dialog|popup/i.test(partText)) {
        globalSteps.push({
          action: "acceptalert",
          target: "triggerAlertButton"
        });
        if (!locators.triggerAlertButton) locators.triggerAlertButton = "//button[contains(text(),'Alert')]";
        continue;
      }
      if (/random|generate/i.test(partText)) {
        globalSteps.push({
          action: "generaterandomdata",
          type: partText.includes("email") ? "email" : partText.includes("phone") ? "phone" : "string",
          saveAs: "randomValue"
        });
        continue;
      }
      const partSteps = [];
      const isFormPart = /create|add|new|fill|form|enter|register|submit|save/i.test(partText);
      for (const [key, value] of Object.entries(testData)) {
        if (value === void 0 || value === null || usedKeys.has(key)) continue;
        let idx = this.findKeywordIndex(key, partText);
        const isFormKey = !/email|username|password|credential|login|signin/i.test(key);
        if (isFormKey && !isFormPart) continue;
        if (idx === -1) {
          if (isFormKey && isFormPart) idx = 9e3;
          else continue;
        }
        const target = this.pickLocatorTarget(locators, [key]);
        if (!target || usedTargets.has(target)) continue;
        partSteps.push({
          index: idx,
          stepObj: {
            action: this.inferInputAction(key, partText),
            target,
            value
          }
        });
        usedKeys.add(key);
        usedTargets.add(target);
      }
      for (const key of Object.keys(locators)) {
        if (usedTargets.has(key) || key === "applicationUrl" || /emailField|passwordField|signInButton/i.test(key)) continue;
        let idx = this.findKeywordIndex(key, partText);
        const isFormLocator = /add|create|new|save|submit|field|input|textarea|dropdown|select/i.test(key);
        if (isFormLocator && !isFormPart) continue;
        if (idx === -1) {
          if (isFormPart && /save|submit|add|create/i.test(key)) idx = 9500;
          else continue;
        }
        const normalizedKey = key.toLowerCase();
        let action = "click";
        let val = void 0;
        if (/message|success|error|warning|result|dashboard|header|title|expected|element|verify|assert/i.test(normalizedKey)) {
          action = req.expectedText ? "assertText" : "assertVisible";
          val = req.expectedText ?? "visible";
        }
        partSteps.push({
          index: idx,
          stepObj: { action, target: key, value: val }
        });
        usedTargets.add(key);
      }
      partSteps.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        const actionA = String(a.stepObj.action).toLowerCase();
        const actionB = String(b.stepObj.action).toLowerCase();
        const targetA = String(a.stepObj.target).toLowerCase();
        const targetB = String(b.stepObj.target).toLowerCase();
        const isAddClickA = actionA === "click" && /add|create|new/i.test(targetA) && !/save|submit/i.test(targetA);
        const isAddClickB = actionB === "click" && /add|create|new/i.test(targetB) && !/save|submit/i.test(targetB);
        if (isAddClickA && !isAddClickB) return -1;
        if (!isAddClickA && isAddClickB) return 1;
        const isClickA = actionA === "click";
        const isClickB = actionB === "click";
        const isAssertA = actionA.startsWith("assert") || actionA.startsWith("verify");
        const isAssertB = actionB.startsWith("assert") || actionB.startsWith("verify");
        if (isClickA && !isClickB) return isAssertB ? -1 : 1;
        if (!isClickA && isClickB) return isAssertA ? 1 : -1;
        if (isAssertA && !isAssertB) return 1;
        if (!isAssertA && isAssertB) return -1;
        return 0;
      });
      for (const s of partSteps) {
        globalSteps.push(s.stepObj);
      }
      const hasAssertion = partSteps.some((s) => s.stepObj.action.startsWith("assert") || s.stepObj.action.startsWith("verify"));
      if (!hasAssertion && (partText.includes("verify") || partText.includes("assert") || partText.includes("check") || partText.includes("display") || partText.includes("success"))) {
        const verifyTarget = Object.keys(locators).find(
          (k) => k.toLowerCase() !== "applicationurl" && !/email|password|login|signin/i.test(k) && this.findKeywordIndex(k, partText) !== -1
        );
        if (verifyTarget) {
          globalSteps.push({ action: "assertVisible", target: verifyTarget });
          usedTargets.add(verifyTarget);
        } else {
          const words = this.significantWords(partText);
          const genericVerbs = ["create", "add", "new", "submit", "save", "update", "delete", "verify", "assert", "check", "success", "successfully"];
          const targetNoun = words.find((w) => !genericVerbs.includes(w)) || words[0] || "success";
          let defaultText = targetNoun.charAt(0).toUpperCase() + targetNoun.slice(1);
          let locatorKey = `${defaultText.toLowerCase()}PageLocator`;
          globalSteps.push({ action: "assertVisible", target: locatorKey });
          locators[locatorKey] = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${defaultText.toLowerCase()}")]`;
          req.locators = locators;
          usedTargets.add(locatorKey);
        }
      }
    }
    return globalSteps.map((s, idx) => ({
      step: idx + 1,
      ...s
    }));
  }
  findKeywordIndex(key, text) {
    const normalizedKey = key.toLowerCase();
    let idx = text.indexOf(normalizedKey);
    if (idx !== -1) return idx;
    const splitKey = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    idx = text.indexOf(splitKey);
    if (idx !== -1) return idx;
    const genericModifiers = ["valid", "invalid", "existing", "new", "create", "enter", "field", "button", "input", "select", "click"];
    const words = splitKey.split(" ").filter((w) => !genericModifiers.includes(w));
    for (const word of words) {
      if (word.length > 2) {
        const wordIdx = text.indexOf(word);
        if (wordIdx !== -1) return wordIdx;
      }
    }
    const firstNonGeneric = splitKey.split(" ").find((w) => !genericModifiers.includes(w));
    if (firstNonGeneric && firstNonGeneric.length > 3) {
      return text.indexOf(firstNonGeneric);
    }
    return -1;
  }
  inferInputAction(key, requirement) {
    if (/country|state|type|category|dropdown|select/i.test(key)) return "select";
    if (/search|query|keyword/i.test(key) || requirement.includes("search")) return "fill";
    return "fill";
  }
  locatorSearchText(key, selector) {
    return `${key} ${selector}`.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  }
  significantWords(value) {
    const stopWords = /* @__PURE__ */ new Set(["the", "a", "an", "to", "for", "of", "and", "item", "items", "product", "products"]);
    return (value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[a-zA-Z0-9]+/g) ?? []).map((word) => word.toLowerCase()).filter((word) => word.length > 1 && !stopWords.has(word));
  }
  normalizeLocatorAliases(locatorsInput) {
    if (!locatorsInput || typeof locatorsInput !== "object") return {};
    const locators = Object.fromEntries(
      Object.entries(locatorsInput).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => [key, String(value).trim()]).filter(([, value]) => value.length > 0)
    );
    return locators;
  }
  findLocatorValue(locators, candidates, pattern) {
    const entries = Object.entries(locators);
    for (const candidate of candidates) {
      const normalizedCandidate = this.normalizeKey(candidate);
      const match = entries.find(([key]) => this.normalizeKey(key) === normalizedCandidate);
      if (match) return match[1];
    }
    if (pattern) {
      const match = entries.find(([key]) => pattern.test(key));
      if (match) return match[1];
    }
    return void 0;
  }
  pickLocatorTarget(locators, candidates) {
    for (const candidate of candidates) {
      if (locators[candidate]) return candidate;
    }
    const normalizedCandidates = new Set(candidates.map((candidate) => this.normalizeKey(candidate)));
    const match = Object.keys(locators).find((key) => normalizedCandidates.has(this.normalizeKey(key)));
    if (match) return match;
    for (const candidate of candidates) {
      const normCand = this.normalizeKey(candidate);
      const subMatch = Object.keys(locators).find((key) => {
        const normKey = this.normalizeKey(key);
        return normKey.includes(normCand) || normCand.includes(normKey);
      });
      if (subMatch) return subMatch;
    }
    for (const candidate of candidates) {
      const normCand = this.normalizeKey(candidate);
      const isLoginCand = /email|username|password|credential|login|signin/i.test(normCand);
      const genericMatch = Object.keys(locators).find((key) => {
        const normKey = this.normalizeKey(key);
        const isLoginLocator = /emailField$|passwordField$|signInButton$/i.test(key) || (normKey === "email" || normKey === "password" || normKey === "username");
        if (isLoginCand && !isLoginLocator && normKey.length > normCand.length + 3) {
          return false;
        }
        if (!isLoginCand && isLoginLocator) {
          return false;
        }
        return normCand.includes("email") && normKey.includes("email") || normCand.includes("pass") && normKey.includes("pass") || normCand.includes("user") && normKey.includes("user") || normCand.includes("mail") && normKey.includes("mail");
      });
      if (genericMatch) return genericMatch;
    }
    return void 0;
  }
  normalizeKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  readPriority(value, fallback) {
    const raw = value.priority ?? value.order ?? value.sequence ?? value.rank;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  normalizeDependsOn(value) {
    if (value === void 0 || value === null || value === false) return [];
    const values = Array.isArray(value) ? value : [value];
    return values.map((entry) => typeof entry === "string" ? entry : entry && typeof entry === "object" ? String(entry.key ?? entry.name ?? entry.requirement ?? "") : "").map((entry) => entry.trim()).filter(Boolean);
  }
  reindexSteps(steps) {
    return steps.map((step, index) => ({
      ...step,
      step: index + 1
    }));
  }
  normalizeSteps(steps) {
    return steps.map((step, index) => ({
      ...step,
      step: step.step ?? index + 1,
      target: step.target ?? "",
      value: step.value ?? ""
    }));
  }
};

// src/agents/generate/GenerateAgent.ts
var import_fs_extra3 = require("fs-extra");
var import_crypto = require("crypto");
var import_path4 = __toESM(require("path"));
var import_child_process = require("child_process");
var GenerateAgent = class {
  constructor() {
    this.logger = logger_default.getInstance();
    this.generatedDir = import_path4.default.resolve("generated");
    this.pagesDir = import_path4.default.resolve("generated", "pages");
    this.locatorsDir = import_path4.default.resolve("generated", "locators");
    this.testsDir = import_path4.default.resolve("generated", "tests");
    this.promptPath = import_path4.default.resolve("prompts", "generation.txt");
    this.historyPath = import_path4.default.resolve("storage", "healing-history.json");
    this.artifactIndexPath = import_path4.default.resolve("generated", ".artifact-index.json");
    this.apiStatePath = import_path4.default.resolve("storage", "api-state.json");
  }
  async run(planPath, executionError) {
    try {
      let plan = await this.applyApiStateToPlan(JSON.parse(await (0, import_fs_extra3.readFile)(planPath, "utf-8")));
      plan = await this.normalizePlan(plan);
      const planFingerprint = this.planFingerprint(plan);
      const reusableSpec = executionError ? void 0 : await this.findReusableGeneratedSpec(plan, planFingerprint);
      if (reusableSpec) {
        this.logger.info(`GenerateAgent: reusing existing generated spec ${reusableSpec}`);
        return reusableSpec;
      }
      const provider = LLMProviderFactory.getProvider();
      const template = await (0, import_fs_extra3.readFile)(this.promptPath, "utf-8");
      const frameworkApiDoc = await FrameworkApiExtractor.extractApiDocs();
      const MAX_RETRIES = 3;
      let attempt = 0;
      let compilationErrors = "";
      let validationError = "";
      let lastPromptSpec = "";
      let lastSupportFiles = {};
      await (0, import_fs_extra3.ensureDir)(this.pagesDir);
      await (0, import_fs_extra3.ensureDir)(this.locatorsDir);
      await (0, import_fs_extra3.ensureDir)(this.testsDir);
      while (attempt < MAX_RETRIES) {
        attempt++;
        this.logger.info(`GenerateAgent: Generation attempt ${attempt}/${MAX_RETRIES}`);
        let prompt = template.replace("{{PLAN_JSON}}", JSON.stringify(plan, null, 2)).replace("{{FRAMEWORK_API}}", frameworkApiDoc);
        if (executionError) {
          prompt += `

---
PREVIOUS RUN FAILURE FEEDBACK:
The previously generated code failed during execution with the following error/log:
${executionError}

Please fix the test steps, actions, or imports in your response to resolve this issue.`;
        }
        if (attempt > 1) {
          prompt += `

---
PREVIOUS GENERATED CODE THAT FAILED VALIDATION/COMPILATION:
`;
          if (lastPromptSpec) {
            prompt += `TEST SPEC:
\`\`\`typescript
${lastPromptSpec}
\`\`\`

`;
          }
          for (const [fileName, fileContent] of Object.entries(lastSupportFiles)) {
            prompt += `SUPPORT FILE ${fileName}:
\`\`\`typescript
${fileContent}
\`\`\`

`;
          }
          if (validationError) {
            prompt += `
VALIDATION ERROR:
${validationError}
`;
          }
          if (compilationErrors) {
            prompt += `
COMPILATION ERRORS:
${compilationErrors}
`;
          }
          prompt += `

Please analyze the errors above, correct the imports, page objects, locator definitions, and method implementations, and rewrite the entire output (including LOCATORS, PAGE_OBJECT, and TEST_SPEC sections) to be completely error-free.`;
        }
        this.logger.info(`GenerateAgent: calling LLM provider (attempt ${attempt}/${MAX_RETRIES})`);
        let rawOutput = "";
        try {
          rawOutput = await provider.generate(prompt);
        } catch (err) {
          this.logger.warn(`GenerateAgent: prompt execution failed on attempt ${attempt}`, { error: err });
          validationError = `LLM generation failed: ${err instanceof Error ? err.message : String(err)}`;
          compilationErrors = "";
          continue;
        }
        const parsedOutput = this.parsePromptOutput(rawOutput);
        const promptSpec = this.normalizeSpecCode(parsedOutput.testSpec);
        let supportFiles = this.resolveSupportFiles(parsedOutput, promptSpec);
        if (plan.locators && typeof plan.locators === "object" && Object.keys(plan.locators).length > 0) {
          supportFiles = this.applyPlanLocatorsToImportedFiles(supportFiles, promptSpec, plan.locators, plan.applicationUrl, plan.scenario, plan.testData);
        }
        supportFiles = this.pruneSupportFilesToImportGraph(supportFiles, promptSpec);
        lastPromptSpec = promptSpec;
        lastSupportFiles = supportFiles;
        const acceptedPromptSpec = Boolean(
          promptSpec && this.hasPageAndLocatorSupport(supportFiles) && this.pageSupportUsesFrameworkHelpers(supportFiles) && this.isValidGeneratedCode(promptSpec, plan, supportFiles)
        );
        if (!acceptedPromptSpec) {
          const reason = this.getInvalidReason(promptSpec, plan, supportFiles);
          validationError = `Validation failed: ${reason}`;
          this.logger.warn(`GenerateAgent: Attempt ${attempt} failed validation: ${reason}`);
          compilationErrors = "";
          continue;
        }
        let generatedCode2 = this.ensureMinimumTestTimeout(this.addExecutionLogsToSpec(
          this.normalizeSpecImports(promptSpec, supportFiles)
        ));
        const sanitizedScenarioName2 = this.deriveClassName(plan.scenario || "GeneratedTest");
        const filePlan2 = await this.planGeneratedWrites(supportFiles, `${sanitizedScenarioName2}.spec.ts`, plan);
        const remappedSupportFiles2 = this.remapSupportFiles(supportFiles, filePlan2.supportFileNames);
        const remappedGeneratedCode2 = this.rewriteGeneratedImportsForUniqueFiles(generatedCode2, filePlan2.supportFileNames);
        const specPath2 = import_path4.default.join(this.testsDir, filePlan2.specFileName);
        this.logger.info(`GenerateAgent: Writing generated files temporarily to check compilation...`);
        await this.writeSupportFiles(remappedSupportFiles2);
        await (0, import_fs_extra3.writeFile)(specPath2, remappedGeneratedCode2);
        this.logger.info(`GenerateAgent: Running TypeScript compilation check on attempt ${attempt}...`);
        const compResult = await new Promise((resolve) => {
          (0, import_child_process.exec)("npx tsc -p tsconfig.generated.json --noEmit", { cwd: process.cwd() }, (error, stdout, stderr) => {
            if (error) {
              resolve({ success: false, errors: stdout || stderr || error.message });
            } else {
              resolve({ success: true, errors: "" });
            }
          });
        });
        if (compResult.success) {
          this.logger.info(`GenerateAgent: Compilation succeeded on attempt ${attempt}!`);
          await this.recordGeneratedArtifact(plan, planPath, planFingerprint, specPath2, remappedSupportFiles2);
          return specPath2;
        } else {
          this.logger.warn(`GenerateAgent: Compilation failed on attempt ${attempt}.
Errors:
${compResult.errors}`);
          compilationErrors = compResult.errors;
          validationError = "";
          this.logger.info(`GenerateAgent: Cleaning up failed compilation files from disk before retry...`);
          try {
            await (0, import_fs_extra3.remove)(specPath2);
            for (const remappedName of Object.keys(remappedSupportFiles2)) {
              const isLocatorFile = this.isLocatorSupportFile(remappedName, remappedSupportFiles2[remappedName]);
              const targetDir = isLocatorFile ? this.locatorsDir : this.pagesDir;
              await (0, import_fs_extra3.remove)(import_path4.default.join(targetDir, remappedName));
              if (isLocatorFile && remappedName.endsWith(".ts")) {
                await (0, import_fs_extra3.remove)(import_path4.default.join(targetDir, remappedName.replace(/\.ts$/, ".json")));
              }
            }
          } catch (cleanupErr) {
            this.logger.warn(`GenerateAgent: failed to clean up failed compilation files`, { error: cleanupErr });
          }
        }
      }
      this.logger.warn("GenerateAgent: All generation attempts failed validation or compilation. Falling back to local structured fallback.");
      const fallbackBundle = this.generateStructuredFallback(plan);
      const filesToWrite = fallbackBundle.supportFiles;
      let generatedCode = this.ensureMinimumTestTimeout(this.addExecutionLogsToSpec(fallbackBundle.testSpec));
      this.validateGeneratedCode(generatedCode, filesToWrite, plan);
      const sanitizedScenarioName = this.deriveClassName(plan.scenario || "GeneratedTest");
      const filePlan = await this.planGeneratedWrites(filesToWrite, `${sanitizedScenarioName}.spec.ts`, plan);
      const remappedSupportFiles = this.remapSupportFiles(filesToWrite, filePlan.supportFileNames);
      const remappedGeneratedCode = this.rewriteGeneratedImportsForUniqueFiles(generatedCode, filePlan.supportFileNames);
      const specPath = import_path4.default.join(this.testsDir, filePlan.specFileName);
      await this.writeSupportFiles(remappedSupportFiles);
      await (0, import_fs_extra3.writeFile)(specPath, remappedGeneratedCode);
      await this.recordGeneratedArtifact(plan, planPath, planFingerprint, specPath, remappedSupportFiles);
      this.logger.info(`Generated fallback spec at ${specPath}`);
      return specPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error("GenerateAgent failed", { error: msg });
      if (err instanceof FrameworkError) {
        throw err;
      }
      throw new FrameworkError("Generation failed", err);
    }
  }
  async normalizePlan(plan) {
    const scenario = this.scenarioText(plan.scenario ?? plan.requirement ?? plan.testName, "Generated scenario");
    const requirements = this.requirementItems(plan.requirements ?? plan.scenario ?? plan.requirement ?? plan.testName);
    const applicationUrl = plan.applicationUrl ?? this.inferApplicationUrlFromSteps(plan.steps) ?? process.env.BASE_URL;
    const baseLocators = this.normalizeLocatorAliases(plan.locators);
    if (applicationUrl) baseLocators.applicationUrl = String(applicationUrl);
    const normalized = {
      ...plan,
      scenario,
      applicationUrl,
      locators: baseLocators
    };
    if (requirements.length > 1 && !Array.isArray(normalized.requirements)) {
      normalized.requirements = requirements;
    }
    normalized.steps = this.filterStepsToResolvedLocators(
      Array.isArray(normalized.steps) ? normalized.steps : [],
      normalized.locators,
      normalized.testData
    );
    return normalized;
  }
  scenarioText(value, fallback = "Generated scenario") {
    const items = this.requirementItems(value);
    if (items.length) return items.join(" ");
    return fallback;
  }
  requirementItems(value) {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.requirementItems(entry));
    }
    if (typeof value === "string") {
      const trimmed = value.replace(/\s+/g, " ").trim();
      return trimmed ? [trimmed] : [];
    }
    if (value && typeof value === "object") {
      const record = value;
      return this.requirementItems(
        record.requirement ?? record.scenario ?? record.name ?? record.testName ?? record.description ?? record.objective ?? this.stableStringify(record)
      );
    }
    if (value === void 0 || value === null) return [];
    const text = String(value).replace(/\s+/g, " ").trim();
    return text ? [text] : [];
  }
  async applyApiStateToPlan(plan) {
    const apiState = await this.readApiState();
    if (!apiState) return plan;
    const resolvedPlan = this.resolveTemplatesInObject(plan, {
      apiState,
      api: apiState.responses ?? {},
      values: apiState.values ?? {},
      ...apiState.values ?? {}
    });
    if (JSON.stringify(resolvedPlan) !== JSON.stringify(plan)) {
      this.logger.info(`GenerateAgent: resolved plan placeholders from ${import_path4.default.relative(process.cwd(), this.apiStatePath)}`);
    }
    return resolvedPlan;
  }
  async readApiState() {
    try {
      if (!await (0, import_fs_extra3.pathExists)(this.apiStatePath)) return void 0;
      const parsed = JSON.parse(await (0, import_fs_extra3.readFile)(this.apiStatePath, "utf-8"));
      return parsed && typeof parsed === "object" ? parsed : void 0;
    } catch {
      this.logger.warn(`GenerateAgent: ignoring unreadable API state ${this.apiStatePath}`);
      return void 0;
    }
  }
  resolveTemplatesInObject(value, context) {
    if (typeof value === "string") return this.resolveTemplateString(value, context);
    if (Array.isArray(value)) return value.map((entry) => this.resolveTemplatesInObject(entry, context));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, this.resolveTemplatesInObject(entry, context)])
    );
  }
  resolveTemplateString(value, context) {
    const exactPlaceholder = value.match(/^\$\{([^}]+)\}$/);
    if (exactPlaceholder) {
      const resolved = this.lookupTemplateValue(exactPlaceholder[1].trim(), context);
      if (resolved !== void 0 && resolved !== null) return resolved;
    }
    return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
      const resolved = this.lookupTemplateValue(String(expression).trim(), context);
      if (resolved === void 0 || resolved === null) return match;
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  lookupTemplateValue(expression, context) {
    if (/^env:/i.test(expression)) {
      return process.env[expression.replace(/^env:/i, "")];
    }
    return context[expression] ?? this.readContextPath(context, expression) ?? process.env[expression];
  }
  readContextPath(value, selector) {
    const normalized = selector.replace(/^\$\./, "").replace(/^\$/, "").trim();
    if (!normalized) return value;
    return normalized.split(".").reduce((current, segment) => {
      if (current === void 0 || current === null) return void 0;
      const arrayMatch = segment.match(/^([^\[]+)\[(\d+)\]$/);
      if (arrayMatch) {
        const record = current;
        const arrayValue = record[arrayMatch[1]];
        return Array.isArray(arrayValue) ? arrayValue[Number(arrayMatch[2])] : void 0;
      }
      if (/^\d+$/.test(segment) && Array.isArray(current)) return current[Number(segment)];
      if (typeof current === "object") return current[segment];
      return void 0;
    }, value);
  }
  async findReusableGeneratedSpec(plan, planFingerprint) {
    const index = await this.readArtifactIndex();
    const scenarioKey = this.scenarioKey(plan);
    const reusable = index.entries.find((entry) => entry.planFingerprint === planFingerprint && entry.scenarioKey === scenarioKey);
    if (!reusable) return void 0;
    const specPath = this.resolveIndexedPath(reusable.specPath);
    const supportFiles = reusable.supportFiles.map((file) => this.resolveIndexedPath(file));
    const allFiles = [specPath, ...supportFiles];
    if (!allFiles.every((file) => this.isShortVisibleFileName(file))) return void 0;
    const allExist = (await Promise.all(allFiles.map((file) => (0, import_fs_extra3.pathExists)(file)))).every(Boolean);
    return allExist ? specPath : void 0;
  }
  async recordGeneratedArtifact(plan, planPath, planFingerprint, specPath, supportFiles) {
    await (0, import_fs_extra3.ensureDir)(this.generatedDir);
    const index = await this.readArtifactIndex();
    const scenarioKey = this.scenarioKey(plan);
    const supportFilePaths = Object.keys(supportFiles).map((fileName) => {
      const targetDir = this.isLocatorSupportFile(fileName, supportFiles[fileName]) ? this.locatorsDir : this.pagesDir;
      return this.relativePath(import_path4.default.join(targetDir, fileName));
    });
    const nextEntry = {
      planFingerprint,
      scenarioKey,
      scenario: this.scenarioText(plan.scenario, "Generated scenario"),
      planPath: this.relativePath(planPath),
      specPath: this.relativePath(specPath),
      supportFiles: supportFilePaths,
      generatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    index.entries = [
      ...index.entries.filter((entry) => !(entry.planFingerprint === planFingerprint && entry.scenarioKey === scenarioKey)),
      nextEntry
    ];
    await (0, import_fs_extra3.writeFile)(this.artifactIndexPath, JSON.stringify(index, null, 2));
  }
  async readArtifactIndex() {
    try {
      const raw = await (0, import_fs_extra3.readFile)(this.artifactIndexPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) {
        return {
          version: Number(parsed.version) || 1,
          entries: parsed.entries.filter((entry) => Boolean(entry && typeof entry === "object"))
        };
      }
    } catch {
    }
    return { version: 1, entries: [] };
  }
  resolveIndexedPath(filePath) {
    return import_path4.default.isAbsolute(filePath) ? filePath : import_path4.default.resolve(filePath);
  }
  relativePath(filePath) {
    return import_path4.default.relative(process.cwd(), import_path4.default.resolve(filePath)).split(import_path4.default.sep).join("/");
  }
  planFingerprint(plan) {
    const stablePlan = {
      scenario: this.scenarioText(plan.scenario, ""),
      env: plan.env ?? plan.environment ?? "default",
      applicationUrl: plan.applicationUrl ?? "",
      steps: Array.isArray(plan.steps) ? plan.steps : [],
      locators: plan.locators ?? {},
      testData: plan.testData ?? {}
    };
    return (0, import_crypto.createHash)("sha256").update(this.stableStringify(stablePlan)).digest("hex").slice(0, 20);
  }
  scenarioKey(plan) {
    return this.normalizeKey(`${plan.applicationUrl ?? ""}:${this.scenarioText(plan.scenario, "Generated scenario")}`);
  }
  stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const record = value;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
  generateStructuredFallback(plan) {
    const className = this.deriveClassName(plan.scenario || "GeneratedTest");
    const locatorExport = `${className}Locators`;
    const locatorKeyType = this.locatorKeyTypeName(locatorExport);
    const pageClass = `${className}Page`;
    const locators = this.prepareFallbackLocators(plan);
    const locatorFileName = `${className}Locators.ts`;
    const jsonFileName = `${className}Locators.json`;
    const pageFileName = `${className}Page.ts`;
    return {
      supportFiles: {
        [locatorFileName]: this.buildLocatorsFromPlan(locators, plan.applicationUrl, locatorExport, "", plan.testData),
        [jsonFileName]: this.buildLocatorsJson(locators, plan.applicationUrl, plan.testData),
        [pageFileName]: this.buildStructuredPageObject(pageClass, locatorExport, locatorKeyType, plan, locators)
      },
      testSpec: this.buildStructuredSpec(plan, pageClass, locatorExport, locators)
    };
  }
  buildStructuredPageObject(pageClass, locatorExport, locatorKeyType, plan, locators) {
    const steps = Array.isArray(plan.steps) && plan.steps.length ? plan.steps : [{ action: "navigate", target: "applicationUrl" }];
    const methodNames = this.buildMethodNamesForSteps(steps);
    const methods = steps.map((step, index) => this.buildPageMethodForStep(step, methodNames[index], locators, plan.testData)).filter(Boolean).join("\n\n");
    return `import { Page } from '@playwright/test';
import { BasePage } from '../../src/framework/BasePage';
import { CommonActions } from '../../src/framework/CommonActions';
import { ${locatorExport} } from '../locators/${locatorExport}';

export class ${pageClass} extends BasePage {
  private readonly locators = ${locatorExport};
  private readonly actions: CommonActions;

  constructor(page: Page) {
    super(page);
    this.actions = new CommonActions(page);
  }

${methods}
}
`;
  }
  buildPageMethodForStep(step, methodName, locators, testData) {
    const action = String(step?.action || "").toLowerCase();
    if (this.isDataOnlyItemsStep(step, testData)) return "";
    const targetKey = this.resolveLocatorKey(String(step?.target ?? ""), locators);
    const keyExpression = targetKey ? `this.locators.${targetKey}` : "";
    const keyLiteral = targetKey ? JSON.stringify(targetKey) : "";
    const valueParameter = this.stepUsesValueParameter(action) ? ", value: string" : "";
    switch (action) {
      case "navigate":
        return `  async ${methodName}(): Promise<void> {
    await this.navigateTo(${targetKey ? keyExpression : "this.locators.applicationUrl"});
  }`;
      case "acceptalert":
      case "acceptdialog":
      case "clickandacceptalert":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.clickAction(${keyExpression}, 'andAcceptAlert', { expectedText: value });
  }`;
      case "dismissalert":
      case "dismissdialog":
      case "clickanddismissalert":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.clickAction(${keyExpression}, 'andDismissAlert', { expectedText: value });
  }`;
      case "verifyvisible":
      case "assertvisible":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.validationAction(${keyExpression}, 'verifyVisible');
  }`;
      case "verifyenabled":
      case "assertenabled":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.validationAction(${keyExpression}, 'verifyEnabled');
  }`;
      case "asserthidden":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.validationAction(${keyExpression}, 'verifyHidden');
  }`;
      case "fill":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.smartInput(${keyExpression}, 'clearAndEnter', value);
  }`;
      case "click":
      case "logout":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.clickAction(${keyExpression}, 'click');
  }`;
      case "clickifvisible":
      case "closeifvisible":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.clickAction(${keyExpression}, 'conditional');
  }`;
      case "select":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.selectDropdown(${keyExpression}, 'byValue', value);
  }`;
      case "selectbytext":
      case "choose":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.selectDropdown(${keyExpression}, 'byText', value);
  }`;
      case "fillandchoose":
      case "autocomplete":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.selectDropdown(${keyExpression}, 'searchAndSelect', value, { searchText: value });
  }`;
      case "check":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.checkboxAction(${keyExpression}, 'check');
  }`;
      case "uncheck":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.checkboxAction(${keyExpression}, 'uncheck');
  }`;
      case "press":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.press(${keyExpression}, value);
  }`;
      case "hover":
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.mouseAction(${keyExpression}, 'hover');
  }`;
      case "uploadfile":
      case "upload":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.fileAction(${keyExpression}, 'upload', { filePath: value });
  }`;
      case "downloadfile":
        if (!targetKey) return "";
        return `  async ${methodName}(downloadDir = 'downloads'): Promise<string> {
    return await this.actions.fileAction(${keyExpression}, 'download', { downloadDir });
  }`;
      case "draganddrop":
      case "dragdrop":
      case "drag":
        if (!targetKey) return "";
        const dropTargetKey = this.resolveSecondaryTargetKey(step, locators);
        if (!dropTargetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.mouseAction(${keyExpression}, 'dragAndDrop', { target: this.locators.${dropTargetKey} });
  }`;
      case "asserttext":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.validationAction(${keyExpression}, 'verifyText', value);
  }`;
      case "assertvalue":
        if (!targetKey) return "";
        return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.validationAction(${keyExpression}, 'verifyValue', value);
  }`;
      case "api":
      case "db":
      case "querydb":
      case "generaterandomdata":
      case "validatepdf":
      case "validateexcel":
      case "validatezip":
        return "";
      default:
        if (!targetKey) return "";
        return `  async ${methodName}(): Promise<void> {
    await this.actions.validationAction(${keyExpression}, 'verifyVisible');
  }`;
    }
  }
  buildStructuredSpec(plan, pageClass, locatorExport, locators) {
    const scenario = this.scenarioText(plan.scenario, "Generated scenario");
    const pageVar = `${pageClass.charAt(0).toLowerCase()}${pageClass.slice(1)}`;
    const testDataExport = this.testDataExportName(locatorExport);
    const steps = Array.isArray(plan.steps) && plan.steps.length ? plan.steps : [{ action: "navigate", target: "applicationUrl" }];
    const methodNames = this.buildMethodNamesForSteps(steps);
    const body = steps.map((step, index) => this.buildStructuredStep(step, index, pageVar, locatorExport, locators, plan.testData, methodNames[index], testDataExport)).filter(Boolean).join("\n\n");
    let extraImports = "";
    const hasApi = steps.some((s) => String(s.action).toLowerCase() === "api");
    const hasData = steps.some((s) => ["db", "querydb", "generaterandomdata", "validatepdf", "validateexcel", "validatezip"].includes(String(s.action).toLowerCase()));
    if (hasApi) {
      extraImports += `import { ApiEngine } from '../../src/framework/ApiEngine';
`;
    }
    if (hasData) {
      extraImports += `import { DataEngine } from '../../src/framework/DataEngine';
`;
    }
    return `import { test, expect } from '@playwright/test';
import { ${pageClass} } from '../pages/${pageClass}';
import { ${locatorExport}, ${testDataExport} } from '../locators/${locatorExport}';
${extraImports}
test(${JSON.stringify(scenario)}, async ({ page }) => {
  test.setTimeout(60000);
  const ${pageVar} = new ${pageClass}(page);

${body || `  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });`}
});
`;
  }
  buildStructuredStep(step, index, pageVar, locatorExport, locators, testData, methodName, testDataExport) {
    const action = String(step?.action || "").toLowerCase();
    if (this.isDataOnlyItemsStep(step, testData)) return "";
    const targetKey = this.resolveLocatorKey(String(step?.target ?? ""), locators);
    const value = this.resolveStepValue(step, testData);
    const valueExpression = this.stepValueExpression(step, value, testData, testDataExport);
    const callName = methodName || this.methodNameForStep(step, index);
    const title = this.friendlyStepTitle(step, index, callName);
    let code = "";
    switch (action) {
      case "navigate":
        const expectedUrl = targetKey ? `${locatorExport}.${targetKey}` : `${locatorExport}.applicationUrl`;
        code = `await ${pageVar}.${callName}();
    await expect(page).toHaveURL(${expectedUrl});`;
        break;
      case "verifyvisible":
      case "assertvisible":
      case "verifyenabled":
      case "assertenabled":
      case "asserthidden":
      case "click":
      case "logout":
      case "check":
      case "uncheck":
      case "hover":
      case "clickifvisible":
      case "closeifvisible":
        if (!targetKey) return "";
        code = `await ${pageVar}.${callName}();`;
        break;
      case "fill":
      case "select":
      case "selectbytext":
      case "choose":
      case "fillandchoose":
      case "autocomplete":
      case "uploadfile":
      case "upload":
      case "asserttext":
      case "assertvalue":
      case "acceptalert":
      case "acceptdialog":
      case "clickandacceptalert":
      case "dismissalert":
      case "dismissdialog":
      case "clickanddismissalert":
        if (!targetKey) return "";
        code = `await ${pageVar}.${callName}(${valueExpression});`;
        break;
      case "press":
        if (!targetKey) return "";
        code = `await ${pageVar}.${callName}(${value ? valueExpression : JSON.stringify("Enter")});`;
        break;
      case "draganddrop":
      case "dragdrop":
      case "drag":
        if (!targetKey || !this.resolveSecondaryTargetKey(step, locators)) return "";
        code = `await ${pageVar}.${callName}();`;
        break;
      case "asserturl":
        code = `await expect(page).toHaveURL(${JSON.stringify(String(value || step?.target || ""))});`;
        break;
      case "downloadfile":
        if (!targetKey) return "";
        const saveAsVar = step.saveAs ? `const ${step.saveAs} = ` : "";
        code = `${saveAsVar}await ${pageVar}.${callName}();`;
        break;
      case "generaterandomdata":
        const randSaveAs = step.saveAs ? `${step.saveAs}` : "randomData";
        let genMethod = "generateRandomString()";
        if (step.type === "email") genMethod = "generateRandomEmail()";
        else if (step.type === "phone") genMethod = "generateRandomPhone()";
        code = `const ${randSaveAs} = DataEngine.${genMethod};
    console.log('Generated random ${step.type ?? "string"}:', ${randSaveAs});`;
        break;
      case "api":
        const apiMethod = step.method ?? "GET";
        const apiUrl = step.url ?? "";
        const apiData = step.data ? `, { data: ${JSON.stringify(step.data)} }` : "";
        const apiSaveAs = step.saveAs ? `const ${step.saveAs} = ` : "";
        code = `const apiEngine = new ApiEngine();
    await apiEngine.init();
    const res = await apiEngine.apiAction('${apiMethod.toLowerCase()}', '${apiUrl}'${apiData});
    ${step.expectedStatus ? `await apiEngine.apiAction('validateResponse', '${apiUrl}', { data: res, expectedStatus: ${step.expectedStatus} });` : ""}
    ${step.expectedText ? `await apiEngine.apiAction('validateResponse', '${apiUrl}', { data: res, expectedText: ${JSON.stringify(step.expectedText)} });` : ""}
    ${step.saveAs ? `${apiSaveAs}await res.json().catch(() => null);` : ""}
    await apiEngine.dispose();`;
        break;
      case "db":
      case "querydb":
        const dbQuery = step.query ?? "";
        const dbParams = step.params ? `, ${JSON.stringify(step.params)}` : "";
        const dbSaveAs = step.saveAs ? `const ${step.saveAs} = ` : "";
        code = `${dbSaveAs}DataEngine.dbAction('executeQuery', ${JSON.stringify(dbQuery)}${dbParams});`;
        break;
      case "validatepdf":
        code = `DataEngine.fileAction('verifyFileExists', ${valueExpression});
    const pdfData = DataEngine.fileAction('readPdf', ${valueExpression});
    expect(pdfData).toBeDefined();`;
        break;
      case "validateexcel":
        code = `DataEngine.fileAction('verifyFileExists', ${valueExpression});
    const excelData = DataEngine.fileAction('readExcel', ${valueExpression});
    expect(excelData).toBeDefined();`;
        break;
      case "validatezip":
        code = `DataEngine.fileAction('verifyFileExists', ${valueExpression});
    const zipData = DataEngine.fileAction('readZip', ${valueExpression});
    expect(zipData).toBeDefined();`;
        break;
      default:
        if (!targetKey) return "";
        code = `await ${pageVar}.${callName}();`;
    }
    return `  await test.step(${JSON.stringify(title)}, async () => {
    ${code}
  });`;
  }
  buildMethodNamesForSteps(steps) {
    const used = /* @__PURE__ */ new Set();
    return steps.map((step, index) => {
      const baseName = this.methodNameForStep(step, index);
      if (!used.has(baseName)) {
        used.add(baseName);
        return baseName;
      }
      const uniqueName = `${baseName}Seq${index + 1}`;
      used.add(uniqueName);
      return uniqueName;
    });
  }
  methodNameForStep(step, index) {
    const action = String(step?.action || "step").toLowerCase();
    const target = String(step?.target || "");
    const value = String(step?.value || "");
    const targetName = this.toPascalName(target) || `Seq${index + 1}`;
    const valueName = this.toPascalName(value);
    const friendlyTargetName = this.friendlyTargetName(target) || `Seq${index + 1}`;
    const normalizedTarget = this.normalizeKey(target);
    switch (action) {
      case "navigate":
        return normalizedTarget && normalizedTarget !== "applicationurl" ? `navigateTo${this.navigationTargetName(target) || friendlyTargetName}` : "navigateToApplication";
      case "fill":
        return `enter${friendlyTargetName}`;
      case "click":
      case "clickifvisible":
      case "closeifvisible":
        if (/close|dismiss|skip/i.test(target)) return `close${friendlyTargetName}IfVisible`;
        if (/admin|module|menu|nav|tab|link/i.test(target)) return `open${friendlyTargetName}`;
        if (/add|create|new/i.test(target)) return `open${friendlyTargetName}Form`;
        if (/save/i.test(target)) return `save${friendlyTargetName}`;
        if (/submit/i.test(target)) return `submit${friendlyTargetName}`;
        if (/search/i.test(target)) return `search${friendlyTargetName}`;
        return `select${friendlyTargetName}`;
      case "select":
        return `select${friendlyTargetName}`;
      case "selectbytext":
      case "choose":
        return `choose${friendlyTargetName}`;
      case "fillandchoose":
      case "autocomplete":
        return `choose${friendlyTargetName}`;
      case "check":
        return `check${targetName}`;
      case "uncheck":
        return `uncheck${targetName}`;
      case "press":
        return `press${targetName}`;
      case "acceptalert":
      case "acceptdialog":
      case "clickandacceptalert":
        return `accept${friendlyTargetName}Alert`;
      case "dismissalert":
      case "dismissdialog":
      case "clickanddismissalert":
        return `dismiss${friendlyTargetName}Alert`;
      case "hover":
        return `hover${targetName}`;
      case "uploadfile":
      case "upload":
        return `upload${targetName}`;
      case "draganddrop":
      case "dragdrop":
      case "drag":
        return `drag${targetName}To${this.toPascalName(this.secondaryTargetName(step)) || "Target"}`;
      case "verifyenabled":
      case "assertenabled":
        return `verify${targetName}Enabled`;
      case "verifyvisible":
      case "assertvisible":
        return `verify${valueName || targetName}Visible`;
      case "asserthidden":
        return `verify${targetName}Hidden`;
      case "asserttext":
        return `verify${valueName || friendlyTargetName}Text`;
      case "assertvalue":
        return `verify${targetName}Value`;
      case "logout":
        return `logoutFrom${targetName}`;
      default:
        return `verify${targetName}`;
    }
  }
  toPascalName(value) {
    return (value.match(/[a-zA-Z0-9]+/g) ?? []).slice(0, 5).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  }
  navigationTargetName(target) {
    try {
      const url = new URL(target);
      const route = url.pathname.split("/").map((part) => part.trim()).filter(Boolean).pop();
      const name = this.toPascalName(route || url.hostname.split(".")[0] || "Application");
      return name ? `${name}Page` : "Application";
    } catch {
      return this.toPascalName(target);
    }
  }
  friendlyTargetName(value) {
    const words = (value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[a-zA-Z0-9]+/g) ?? []).filter((word) => !/^(input|button|btn|dropdown|field|locator|element)$/i.test(word));
    return words.slice(0, 5).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  }
  stepUsesValueParameter(action) {
    return [
      "fill",
      "select",
      "selectbytext",
      "choose",
      "fillandchoose",
      "autocomplete",
      "press",
      "uploadfile",
      "upload",
      "asserttext",
      "assertvalue",
      "acceptalert",
      "acceptdialog",
      "clickandacceptalert",
      "dismissalert",
      "dismissdialog",
      "clickanddismissalert"
    ].includes(action);
  }
  secondaryTargetName(step) {
    return String(
      step?.to ?? step?.dropTarget ?? step?.destination ?? step?.target2 ?? step?.value ?? ""
    );
  }
  resolveSecondaryTargetKey(step, locators) {
    return this.resolveLocatorKey(this.secondaryTargetName(step), locators);
  }
  isDataOnlyItemsStep(step, testData) {
    const action = String(step?.action ?? "").toLowerCase();
    const target = this.normalizeKey(String(step?.target ?? ""));
    return target === "items" && ["fill", "select", "press"].includes(action) && this.normalizeItems(step?.value ?? testData?.items).length > 0;
  }
  normalizeItems(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [];
  }
  reindexSteps(steps) {
    return steps.map((step, index) => ({
      ...step,
      step: index + 1
    }));
  }
  prepareFallbackLocators(plan) {
    const locators = this.normalizeLocatorAliases(plan?.locators);
    const applicationUrl = plan?.applicationUrl ?? this.inferApplicationUrlFromSteps(plan?.steps) ?? process.env.BASE_URL;
    if (applicationUrl) locators.applicationUrl = String(applicationUrl);
    return this.normalizeLocatorAliases(locators);
  }
  filterStepsToResolvedLocators(steps, locators, testData) {
    const droppedTargets = [];
    const filtered = steps.filter((step) => {
      if (!this.stepRequiresLocator(step, testData)) return true;
      const target = String(step?.target ?? "").trim();
      if (target && this.resolveLocatorKey(target, locators)) {
        if (["draganddrop", "dragdrop", "drag"].includes(String(step?.action ?? "").toLowerCase())) {
          return Boolean(this.resolveSecondaryTargetKey(step, locators));
        }
        return true;
      }
      droppedTargets.push(target || String(step?.action ?? "unknown step"));
      return false;
    });
    if (droppedTargets.length) {
      this.logger.warn(`GenerateAgent: skipped ${droppedTargets.length} step(s) with no DOM-backed locator: ${droppedTargets.join(", ")}`);
    }
    return this.reindexSteps(filtered);
  }
  stepRequiresLocator(step, testData) {
    const action = String(step?.action ?? "").toLowerCase();
    if (!action || ["navigate", "asserturl"].includes(action)) return false;
    if (this.isDataOnlyItemsStep(step, testData)) return false;
    return true;
  }
  async discoverLocatorsFromDom(plan, baseLocators) {
    return {};
  }
  normalizeLocatorAliases(locatorsInput) {
    if (!locatorsInput || typeof locatorsInput !== "object") return {};
    const locators = Object.fromEntries(
      Object.entries(locatorsInput).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => [key, String(value).trim()]).filter(([, value]) => value.length > 0)
    );
    return locators;
  }
  findLocatorValue(locators, candidates, pattern) {
    const entries = Object.entries(locators);
    for (const candidate of candidates) {
      const normalizedCandidate = this.normalizeKey(candidate);
      const match = entries.find(([key]) => this.normalizeKey(key) === normalizedCandidate);
      if (match) return match[1];
    }
    if (pattern) {
      const match = entries.find(([key]) => pattern.test(key));
      if (match) return match[1];
    }
    return void 0;
  }
  inferApplicationUrlFromSteps(steps) {
    if (!Array.isArray(steps)) return void 0;
    for (const step of steps) {
      if (String(step?.action ?? "").toLowerCase() !== "navigate") continue;
      const url = [step?.value, step?.target].map((value) => String(value ?? "").trim()).find((value) => /^https?:\/\//i.test(value));
      if (url) return url;
    }
    return void 0;
  }
  resolveLocatorKey(target, locators) {
    if (!target) return void 0;
    if (target !== "applicationUrl" && locators[target]) return target;
    const normalizedTarget = this.normalizeKey(target);
    const exactKey = Object.keys(locators).filter((key) => key !== "applicationUrl").find((key) => this.normalizeKey(key) === normalizedTarget);
    if (exactKey) return exactKey;
    return Object.entries(locators).find(([key, selector]) => key !== "applicationUrl" && selector === target)?.[0];
  }
  looksLikeSelector(value) {
    return /^(\/\/|\.|#|\[|[a-z]+[#.\[]|[a-z]+:|[a-z]+\[)/i.test(value);
  }
  safeLocatorKey(target, action) {
    const words = target.match(/[a-zA-Z0-9]+/g) ?? [action, "target"];
    const [first = action, ...rest] = words;
    return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("")}`;
  }
  resolveStepValue(step, testData) {
    if (step?.value !== void 0 && step.value !== null && step.value !== "") return step.value;
    const targetKey = this.normalizeKey(String(step?.target ?? ""));
    if (testData) {
      const exact = Object.entries(testData).find(([key]) => this.normalizeKey(key) === targetKey);
      if (exact) return exact[1];
    }
    return step?.value;
  }
  stepValueExpression(step, value, testData, testDataExport) {
    if (typeof value === "string" && value.startsWith("$")) {
      const varName = value.substring(1);
      if (/^[A-Za-z_$][\w$]*$/.test(varName)) {
        return varName;
      }
    }
    const dataKey = this.findTestDataKeyForStep(step, value, testData);
    if (dataKey && testDataExport) {
      return `${testDataExport}${this.objectAccess(dataKey)}`;
    }
    return JSON.stringify(String(value ?? ""));
  }
  findTestDataKeyForStep(step, value, testData) {
    if (!testData || value === void 0 || value === null || Array.isArray(value)) return void 0;
    const targetKey = this.normalizeKey(String(step?.target ?? ""));
    const exactTarget = Object.keys(testData).find((key) => this.normalizeKey(key) === targetKey);
    if (exactTarget) return exactTarget;
    const stringValue = String(value);
    return Object.keys(testData).find((key) => {
      const dataValue = testData[key];
      return !Array.isArray(dataValue) && String(dataValue) === stringValue;
    });
  }
  objectAccess(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
  }
  fallbackStepTitle(step, index) {
    if (typeof step === "string") return step.replace(/\s+/g, " ").trim() || `Step ${index + 1}`;
    const action = this.humanizeLogText(String(step?.action || "step"));
    const target = this.humanizeLogText(String(step?.target || ""));
    return [action, target].filter(Boolean).join(" ") || `Step ${index + 1}`;
  }
  friendlyStepTitle(step, index, methodName) {
    if (typeof step === "string") return this.fallbackStepTitle(step, index);
    return methodName ? this.humanizeLogText(methodName) : this.fallbackStepTitle(step, index);
  }
  hasPageAndLocatorSupport(supportFiles) {
    const fileNames = Object.keys(supportFiles);
    return fileNames.some((fileName) => /page/i.test(fileName)) && fileNames.some((fileName) => /locator/i.test(fileName));
  }
  pageSupportUsesFrameworkHelpers(supportFiles) {
    return Object.entries(supportFiles).filter(([fileName]) => /page/i.test(fileName)).every(([, content]) => content.includes("BasePage") && content.includes("CommonActions"));
  }
  /**
   * Build a TypeScript locators object from the plan.locators map.
   * Keeps request selectors unchanged and carries applicationUrl into the locator layer.
   */
  buildLocatorsJson(locators, applicationUrl, testData) {
    const merged = {
      ...Object.fromEntries(Object.entries(locators).map(([key, value]) => [key, String(value ?? "").trim()]))
    };
    merged.applicationUrl = String(applicationUrl || merged.applicationUrl || process.env.BASE_URL || "").trim();
    const orderedLocators = [
      ["applicationUrl", merged.applicationUrl],
      ...Object.entries(merged).filter(([key]) => key !== "applicationUrl")
    ];
    const locatorsObj = Object.fromEntries(orderedLocators);
    const testDataObj = testData ?? {};
    return JSON.stringify({
      locators: locatorsObj,
      testData: testDataObj
    }, null, 2);
  }
  buildLocatorsFromPlan(locators, applicationUrl, exportName, baseCode = "", testData) {
    const className = exportName.endsWith("Locators") ? exportName.slice(0, -"Locators".length) : exportName;
    const jsonImportName = `./${className}Locators.json`;
    return `import locatorsData from '${jsonImportName}';

export const ${exportName} = locatorsData.locators;
export const ${this.testDataExportName(exportName)} = locatorsData.testData;

export type ${this.locatorKeyTypeName(exportName)} = Exclude<keyof typeof ${exportName}, 'applicationUrl'>;
`;
  }
  testDataExportName(locatorExport) {
    return locatorExport.endsWith("Locators") ? `${locatorExport.slice(0, -"Locators".length)}TestData` : `${locatorExport}TestData`;
  }
  stringifyObjectLiteral(value) {
    const json = JSON.stringify(value ?? {}, null, 2);
    return json.replace(/^/gm, "  ").trimStart();
  }
  locatorKeyTypeName(locatorExport) {
    return locatorExport.endsWith("Locators") ? `${locatorExport.slice(0, -"Locators".length)}LocatorKey` : `${locatorExport}Key`;
  }
  applyPlanLocatorsToImportedFiles(supportFiles, testSpec, locators, applicationUrl, scenario, testData) {
    const updated = { ...supportFiles };
    const targets = this.getLocatorImportTargets(updated);
    if (!targets.length) {
      const scenarioClass = this.deriveClassName(scenario);
      const locatorFileName = `${scenarioClass}Locators.ts`;
      updated[locatorFileName] = this.buildLocatorsFromPlan(locators, applicationUrl, `${scenarioClass}Locators`, updated[locatorFileName], testData);
      const jsonFileName = `${scenarioClass}Locators.json`;
      updated[jsonFileName] = this.buildLocatorsJson(locators, applicationUrl, testData);
      this.logger.warn(`GenerateAgent: no imported locator file was detected; prepared ${locatorFileName}`);
      return updated;
    }
    for (const target of targets) {
      updated[target.fileName] = this.buildLocatorsFromPlan(locators, applicationUrl, target.exportName, updated[target.fileName], testData);
      const jsonFileName = target.fileName.replace(/\.ts$/, ".json");
      updated[jsonFileName] = this.buildLocatorsJson(locators, applicationUrl, testData);
      this.logger.info(`GenerateAgent: request locators applied to imported file ${target.fileName}`);
    }
    return this.ensureDirectSpecLocatorImports(updated, testSpec, locators, applicationUrl, scenario, testData);
  }
  ensureDirectSpecLocatorImports(supportFiles, testSpec, locators, applicationUrl, scenario, testData) {
    const updated = { ...supportFiles };
    const directImports = this.getLocatorImportTargets({ TestSpec: testSpec });
    if (!directImports.length) return updated;
    const fallbackExportName = `${this.deriveClassName(scenario)}Locators`;
    for (const target of directImports) {
      updated[target.fileName] = this.buildLocatorsFromPlan(
        locators,
        applicationUrl,
        target.exportName || fallbackExportName,
        updated[target.fileName],
        testData
      );
      const jsonFileName = target.fileName.replace(/\.ts$/, ".json");
      updated[jsonFileName] = this.buildLocatorsJson(locators, applicationUrl, testData);
      this.logger.info(`GenerateAgent: request locators applied to direct spec import ${target.fileName}`);
    }
    return updated;
  }
  getLocatorImportTargets(supportFiles) {
    const targets = /* @__PURE__ */ new Map();
    for (const content of Object.values(supportFiles)) {
      const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g;
      for (const match of content.matchAll(importRegex)) {
        const importPath = match[2];
        if (!/locator/i.test(importPath) && !/locator/i.test(import_path4.default.basename(importPath))) continue;
        const fileName = this.toSupportFileName(importPath);
        for (const importedName of match[1].split(",")) {
          const exportName = importedName.trim().split(/\s+as\s+/i)[0]?.trim();
          if (!exportName || !/locator/i.test(exportName)) continue;
          const key = `${fileName}:${exportName}`;
          if (!targets.has(key)) targets.set(key, { fileName, exportName });
        }
      }
    }
    return Array.from(targets.values());
  }
  pruneSupportFilesToImportGraph(files, entryCode) {
    const keep = /* @__PURE__ */ new Set();
    const visit = (code) => {
      for (const importName of this.getRelativeImportNames(code)) {
        const fileName = this.toSupportFileName(importName);
        if (!files[fileName] || keep.has(fileName)) continue;
        keep.add(fileName);
        visit(files[fileName]);
      }
    };
    visit(entryCode);
    const pruned = Object.fromEntries(Object.entries(files).filter(([fileName]) => keep.has(fileName)));
    const removedCount = Object.keys(files).length - Object.keys(pruned).length;
    if (removedCount > 0) {
      this.logger.info(`GenerateAgent: removed ${removedCount} unreferenced support file(s) before writing`);
    }
    return pruned;
  }
  extractStringLocators(code) {
    const locators = {};
    for (const line2 of code.split(/\r?\n/)) {
      const match = line2.match(/^\s*([A-Za-z_$][\w$]*|['"][^'"]+['"])\s*:\s*(['"`])(.*)\2\s*,?\s*$/);
      if (!match) continue;
      const rawKey = match[1].replace(/^['"]|['"]$/g, "");
      const quote = match[2];
      const rawValue = match[3];
      locators[rawKey] = this.parseStringLiteral(rawValue, quote);
    }
    return locators;
  }
  parseStringLiteral(rawValue, quote) {
    if (quote === '"') {
      try {
        return JSON.parse(`"${rawValue}"`);
      } catch {
        return rawValue;
      }
    }
    return rawValue.replace(/\\(['"`\\])/g, "$1");
  }
  formatObjectKey(key) {
    return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
  }
  async applyHealingHistoryToLocators(locators) {
    const normalized = Object.fromEntries(
      Object.entries(locators).map(([key, value]) => [key, String(value ?? "").trim()])
    );
    let rawHistory = "";
    try {
      rawHistory = await (0, import_fs_extra3.readFile)(this.historyPath, "utf-8");
    } catch {
      return normalized;
    }
    let history = [];
    try {
      history = JSON.parse(rawHistory);
    } catch {
      this.logger.warn("GenerateAgent: healing history could not be parsed; using request locators as-is");
      return normalized;
    }
    const healedSelectorMap = /* @__PURE__ */ new Map();
    for (const entry of history) {
      const oldSelector = String(entry.oldSelector ?? "").trim();
      const newSelector = String(entry.newSelector ?? "").trim();
      if (oldSelector && newSelector && oldSelector !== newSelector && !this.isUnsafeHistoryOverride(oldSelector, newSelector)) {
        healedSelectorMap.set(oldSelector, newSelector);
      }
    }
    let appliedCount = 0;
    const updated = Object.fromEntries(Object.entries(normalized).map(([key, value]) => {
      const healedValue = healedSelectorMap.get(value);
      if (healedValue) {
        appliedCount += 1;
        return [key, healedValue];
      }
      return [key, value];
    }));
    if (appliedCount > 0) {
      this.logger.info(`GenerateAgent: applied ${appliedCount} healed locator override(s) from history`);
    }
    return updated;
  }
  isUnsafeHistoryOverride(oldSelector, newSelector) {
    const specificCollection = /(item|name|result|row|cell|card|list|table|product|cart)/i.test(oldSelector);
    const broadTarget = /^(\.title|#title|h1|h2|body|html|main|section|div|span|\*)$/i.test(newSelector.trim());
    return specificCollection && broadTarget || this.selectorIntentMismatch(oldSelector, newSelector);
  }
  selectorIntentMismatch(oldSelector, newSelector) {
    const oldIntent = this.selectorIntent(oldSelector);
    const newIntent = this.selectorIntent(newSelector);
    return Boolean(oldIntent && newIntent && oldIntent !== newIntent);
  }
  selectorIntent(selector) {
    const normalized = selector.toLowerCase();
    if (/password|passwo|id=["']pass(?:word|rd)?["']|type=["']password|type='password'/.test(normalized)) return "password-input";
    if (/user.?name|email|type=["']email|type='email'/.test(normalized)) return "text-input";
    if (/login|submit|save|button|\bbtn\b/.test(normalized)) return "button";
    if (/cart|shopping/.test(normalized)) return "cart";
    if (/title|header|heading|h1|h2/.test(normalized)) return "heading";
    return void 0;
  }
  toSupportFileName(importName) {
    const baseName = import_path4.default.basename(importName);
    if (baseName.endsWith(".json")) return baseName;
    return baseName.endsWith(".ts") ? baseName : `${baseName}.ts`;
  }
  /** Derive a PascalCase class name from the scenario text */
  deriveClassName(scenario) {
    const words = this.scenarioText(scenario, "GeneratedTest").replace(/[^a-zA-Z0-9\s]/g, " ").trim().split(/\s+/).filter(Boolean);
    const stopWords = /* @__PURE__ */ new Set([
      "automation",
      "verification",
      "verify",
      "user",
      "can",
      "to",
      "successfully",
      "using",
      "email",
      "password",
      "page",
      "loads",
      "load",
      "without",
      "ui",
      "issues",
      "issue",
      "redirects",
      "redirect",
      "back",
      "navigate",
      "site",
      "valid",
      "credentials",
      "shown",
      "after",
      "with",
      "the",
      "and",
      "then",
      "regression",
      "complete",
      "details"
    ]);
    const significant = words.filter((word) => !stopWords.has(word.toLowerCase()));
    const selected = this.hasWords(words, ["automation", "demo", "full"]) ? ["Demo", "Full"] : significant[0]?.toLowerCase() === "login" && significant[1]?.toLowerCase() === "flow" ? significant.slice(0, 2) : significant.slice(0, 3);
    return this.compactFileBase(selected.length ? selected : words.slice(0, 2), 8) || "Test";
  }
  compactFileBase(words, maxLength) {
    const safeMaxLength = Math.max(1, maxLength);
    const normalizedWords = words.flatMap((word) => String(word).replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[a-zA-Z0-9]+/g) ?? []).filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1));
    let output = "";
    for (const word of normalizedWords) {
      if (!output) {
        output = word.slice(0, safeMaxLength);
        continue;
      }
      if (output.length + word.length > safeMaxLength) continue;
      output += word;
    }
    return output || "Test".slice(0, safeMaxLength);
  }
  hasWords(words, expectedWords) {
    const normalizedWords = new Set(words.map((word) => word.toLowerCase()));
    return expectedWords.every((word) => normalizedWords.has(word));
  }
  parsePromptOutput(output) {
    const cleaned = this.cleanGeneratedCode(output);
    return {
      locators: this.cleanSectionCode(this.extractSection(cleaned, "LOCATORS")),
      pageObject: this.cleanSectionCode(this.extractSection(cleaned, "PAGE_OBJECT")),
      testSpec: this.cleanSectionCode(this.extractSection(cleaned, "TEST_SPEC") || cleaned)
    };
  }
  cleanGeneratedCode(output) {
    const trimmed = output.trim();
    const fenced = trimmed.match(/^```(?:ts|typescript)?\s*([\s\S]*?)\s*```$/i);
    return (fenced ? fenced[1] : trimmed).trim();
  }
  extractSection(output, sectionName) {
    const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = output.match(new RegExp(`(?:\\*\\*)?\\s*(?:OPTIONAL\\s+)?SECTION:\\s*${escaped}\\s*(?:\\*\\*)?\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\*\\*)?\\s*(?:OPTIONAL\\s+)?SECTION:\\s*[A-Z_]+|$)`, "i"));
    return (match ? match[1] : "").trim();
  }
  cleanSectionCode(section) {
    let cleaned = section.trim();
    cleaned = cleaned.replace(/^\*\*\s*/g, "").replace(/\s*\*\*$/g, "").trim();
    const fenced = cleaned.match(/^```(?:ts|typescript|javascript|js)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) {
      cleaned = fenced[1].trim();
    } else {
      cleaned = cleaned.replace(/^```(?:ts|typescript|javascript|js)?\s*/i, "").replace(/\s*```$/i, "").trim();
    }
    cleaned = cleaned.split(/\r?\n/).filter((line2) => !/^\s*```/.test(line2) && !/^\s*\*\*\s*$/.test(line2)).join("\n").trim();
    const importIndex = cleaned.indexOf("import ");
    if (importIndex > 0) {
      cleaned = cleaned.slice(importIndex).trim();
    }
    return cleaned;
  }
  validateGeneratedCode(code, supportFiles = {}, plan) {
    if (!code) {
      throw new FrameworkError("Generated code is empty", void 0, "GEN_EMPTY");
    }
    if (!this.isValidGeneratedCode(code, plan, supportFiles)) {
      throw new FrameworkError(`Generated code does not contain a runnable Playwright test: ${this.getInvalidReason(code, plan, supportFiles)}`, void 0, "GEN_INVALID");
    }
  }
  isValidGeneratedCode(code, plan, supportFiles = {}) {
    return Boolean(
      code && code.includes("@playwright/test") && /\btest\s*\(/.test(code) && !/```|\*\*/.test(code) && !this.usesPageObjectInternals(code) && !this.usesGenericPageObjectApi(supportFiles) && !this.usesMissingFrameworkActions(supportFiles) && this.supportFilesAreValid(supportFiles) && this.generatedIdentifiersAreResolved(code, supportFiles) && this.relativeImportsAreSatisfied(code, supportFiles) && this.generatedCodeCoversPlan(code, plan, supportFiles)
    );
  }
  getInvalidReason(code, plan, supportFiles = {}) {
    if (!code) return "missing TEST_SPEC code";
    if (/```|\*\*/.test(code)) return "contains markdown wrappers";
    if (!code.includes("@playwright/test")) return "missing @playwright/test import";
    if (!/\btest\s*\(/.test(code)) return "missing test() block";
    if (!this.hasPageAndLocatorSupport(supportFiles)) return "missing generated page or locator support file";
    if (!this.pageSupportUsesFrameworkHelpers(supportFiles)) return "generated page object does not use framework helpers";
    if (this.usesPageObjectInternals(code)) return "test spec accesses private page object internals";
    if (this.usesGenericPageObjectApi(supportFiles)) return "generated page object uses confusing generic locator methods";
    if (this.usesMissingFrameworkActions(supportFiles)) return "generated page object calls framework actions that do not exist";
    if (!this.supportFilesAreValid(supportFiles)) return "generated support files contain invalid TypeScript or unsupported locator code";
    const unresolved = this.findUnresolvedGeneratedIdentifiers([code, ...Object.values(supportFiles)]).join(", ");
    if (unresolved) return `contains unresolved generated identifier(s): ${unresolved}`;
    if (!this.relativeImportsAreSatisfied(code, supportFiles)) return "imports generated files that were not returned in prompt sections";
    const coverageFailure = this.getPlanCoverageFailure(code, plan, supportFiles);
    if (coverageFailure) return coverageFailure;
    return "unknown validation failure";
  }
  generatedCodeCoversPlan(code, plan, supportFiles = {}) {
    return !this.getPlanCoverageFailure(code, plan, supportFiles);
  }
  getPlanCoverageFailure(code, plan, supportFiles = {}) {
    const steps = this.executablePlanSteps(plan);
    if (!steps.length) return void 0;
    const generatedStepCount = (code.match(/\bawait\s+test\.step\s*\(/g) ?? []).length;
    if (generatedStepCount < steps.length) {
      return `generated spec has ${generatedStepCount} test.step block(s) for ${steps.length} executable plan step(s)`;
    }
    const generatedText = this.coverageText([code, ...Object.values(supportFiles)]);
    const expectedMethodNames = this.buildMethodNamesForSteps(steps);
    const missingMethods = expectedMethodNames.filter((methodName) => !this.includesCoveragePhrase(generatedText, methodName));
    if (missingMethods.length) {
      return `missing generated method(s) for plan step coverage: ${missingMethods.slice(0, 5).join(", ")}`;
    }
    const missingFamilies = this.requiredActionFamilies(steps).filter((family) => !this.coverageHasActionFamily(generatedText, family));
    if (missingFamilies.length) {
      return `missing action flow coverage: ${missingFamilies.join(", ")}`;
    }
    return void 0;
  }
  executablePlanSteps(plan) {
    return (Array.isArray(plan?.steps) ? plan.steps : []).filter((step) => !this.isDataOnlyItemsStep(step, plan?.testData));
  }
  coverageText(contents) {
    return contents.join("\n").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  }
  includesCoveragePhrase(text, value) {
    const phrase = this.coverageText([value]);
    return Boolean(phrase) && text.includes(phrase);
  }
  requiredActionFamilies(steps) {
    return Array.from(new Set(steps.map((step) => this.actionFamily(step)).filter((family) => Boolean(family))));
  }
  actionFamily(step) {
    const action = String(step?.action ?? "").toLowerCase();
    if (action === "navigate" || action === "asserturl") return "navigate";
    if (action === "fill") return "fill";
    if (action === "click" || action === "logout" || action === "clickifvisible" || action === "closeifvisible") return "click";
    if (["select", "selectbytext", "choose", "fillandchoose", "autocomplete"].includes(action)) return "select";
    if (action === "check" || action === "uncheck") return "check";
    if (action === "press") return "press";
    if (action === "hover") return "hover";
    if (action === "uploadfile" || action === "upload") return "upload";
    if (["draganddrop", "dragdrop", "drag"].includes(action)) return "dragdrop";
    if (["acceptalert", "acceptdialog", "clickandacceptalert", "dismissalert", "dismissdialog", "clickanddismissalert"].includes(action)) return "alert";
    if (["verifyvisible", "assertvisible", "verifyenabled", "assertenabled", "asserthidden", "asserttext", "assertvalue", "assert", "verify"].includes(action)) return "assert";
    return void 0;
  }
  coverageHasActionFamily(text, family) {
    const familyTerms = {
      navigate: ["navigate", "goto"],
      fill: ["fill", "enter"],
      click: ["click", "open", "select"],
      select: ["select", "choose"],
      check: ["check", "uncheck"],
      press: ["press"],
      hover: ["hover"],
      upload: ["upload", "set input files"],
      dragdrop: ["drag and drop", "drag drop", "drag"],
      alert: ["accept alert", "dismiss alert", "dialog"],
      assert: ["verify", "assert", "expect"]
    };
    return (familyTerms[family] ?? [family]).some((term) => this.includesCoveragePhrase(text, term));
  }
  usesPageObjectInternals(code) {
    return /\b[A-Za-z_$][\w$]*Page\.(?:page|locators)\b/.test(code);
  }
  usesGenericPageObjectApi(supportFiles) {
    return Object.entries(supportFiles).filter(([fileName]) => /page/i.test(fileName)).some(([, content]) => {
      return /\b(?:element|key|selector)\s*:\s*string\b/.test(content) || /this\.locators\[\s*(?:element|key|selector)\s*\]/.test(content) || /\bfillItems\s*\(/.test(content) || /\b[A-Za-z_$][\w$]*Step\d+\s*\(/.test(content) || /\basync\s+(?:click|fill|clear)[A-Z][A-Za-z0-9_]*\s*\(/.test(content) || /\bthis\.page\.(?:goto|locator|click|fill|press|selectOption|check|uncheck|hover|dragAndDrop|setInputFiles)\s*\(/.test(content) || /\.(?:click|fill|press|selectOption|check|uncheck|hover|dragTo|setInputFiles)\s*\(/.test(
        content.replace(/this\.actions\.(?:click|clickIfVisible|fill|press|select|check|uncheck|hover|dragAndDrop|uploadFile)\s*\(/g, "")
      ) || /\bexpect\s*\(\s*(?:this\.)?page\.locator\(/.test(content);
    });
  }
  usesMissingFrameworkActions(supportFiles) {
    return Object.entries(supportFiles).filter(([fileName]) => /page/i.test(fileName)).some(([, content]) => /\bthis\.actions\.assert(?:Visible|Enabled|Hidden|Text|Value)\s*\(/.test(content));
  }
  generatedIdentifiersAreResolved(code, supportFiles) {
    return this.findUnresolvedGeneratedIdentifiers([code, ...Object.values(supportFiles)]).length === 0;
  }
  findUnresolvedGeneratedIdentifiers(contents) {
    const unresolved = /* @__PURE__ */ new Set();
    for (const code of contents) {
      const available = /* @__PURE__ */ new Set([
        ...this.getImportedIdentifiers(code),
        ...this.getDeclaredIdentifiers(code)
      ]);
      const identifiers = Array.from(code.matchAll(/\b[A-Z][A-Za-z0-9_]*(?:Page|Locators?|Actions|Helpers)\b/g)).map((match) => match[0]);
      for (const identifier of identifiers) {
        if (!available.has(identifier)) unresolved.add(identifier);
      }
    }
    return Array.from(unresolved);
  }
  getImportedIdentifiers(code) {
    const identifiers = [];
    for (const match of code.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"];?/g)) {
      identifiers.push(...match[1].split(",").map((name) => name.trim().split(/\s+as\s+/i).pop() ?? "").filter(Boolean));
    }
    for (const match of code.matchAll(/import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"];?/g)) {
      identifiers.push(match[1]);
    }
    for (const match of code.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+['"][^'"]+['"];?/g)) {
      identifiers.push(match[1]);
    }
    return identifiers;
  }
  getDeclaredIdentifiers(code) {
    return Array.from(code.matchAll(/\b(?:export\s+)?(?:abstract\s+)?(?:class|const|let|var|function|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g)).map((match) => match[1]);
  }
  resolveSupportFiles(parsedOutput, testSpec) {
    const files = {};
    const imports = this.getRelativeImportNames(testSpec);
    const pageBlocks = this.splitGeneratedBlocks(parsedOutput.pageObject || "", "PageObject.ts");
    const locatorBlocks = this.splitGeneratedBlocks(parsedOutput.locators || "", "GeneratedLocators.ts");
    for (const importName of imports) {
      const baseName = import_path4.default.basename(importName, import_path4.default.extname(importName));
      const fileName = this.toSupportFileName(importName);
      if (/locator/i.test(baseName) && parsedOutput.locators) {
        files[fileName] = this.normalizeSupportCode(locatorBlocks[fileName] || parsedOutput.locators);
      } else if (/page/i.test(baseName) && parsedOutput.pageObject) {
        files[fileName] = this.normalizeSupportCode(pageBlocks[fileName] || parsedOutput.pageObject);
      }
    }
    for (const [fileName, content] of Object.entries(pageBlocks)) {
      if (!files[fileName]) files[fileName] = this.normalizeSupportCode(content);
    }
    const nestedLocatorImports = Object.values(files).flatMap((content) => this.getRelativeImportNames(content)).filter((name) => /locator/i.test(name));
    for (const importName of nestedLocatorImports) {
      const fileName = this.toSupportFileName(importName);
      if (parsedOutput.locators && !files[fileName]) {
        files[fileName] = this.normalizeSupportCode(locatorBlocks[fileName] || parsedOutput.locators);
      }
    }
    for (const [fileName, content] of Object.entries(locatorBlocks)) {
      if (!files[fileName] && /locator/i.test(fileName)) files[fileName] = this.normalizeSupportCode(content);
    }
    return files;
  }
  splitGeneratedBlocks(code, fallbackFileName) {
    const cleaned = code.trim();
    if (!cleaned) return {};
    const markerRegex = /^\s*\/\/\s*(?:generated\/)?([\w.-]+\.ts)\s*$/gim;
    const markers = Array.from(cleaned.matchAll(markerRegex));
    if (!markers.length) {
      const className = cleaned.match(/export\s+class\s+(\w+)/)?.[1] ?? cleaned.match(/class\s+(\w+)/)?.[1];
      const exportName = cleaned.match(/export\s+(?:const|enum)\s+(\w+)/)?.[1];
      return { [className ? `${className}.ts` : exportName ? `${exportName}.ts` : fallbackFileName]: cleaned };
    }
    const files = {};
    const firstMarker = markers[0];
    const prefix = cleaned.slice(0, firstMarker.index).trim();
    if (prefix) {
      const className = prefix.match(/export\s+class\s+(\w+)/)?.[1] ?? prefix.match(/class\s+(\w+)/)?.[1];
      files[className ? `${className}.ts` : fallbackFileName] = prefix;
    }
    for (let index = 0; index < markers.length; index += 1) {
      const marker = markers[index];
      const next = markers[index + 1];
      const start = (marker.index ?? 0) + marker[0].length;
      const end = next?.index ?? cleaned.length;
      const content = cleaned.slice(start, end).trim();
      if (content) files[marker[1]] = content;
    }
    return files;
  }
  normalizeSupportCode(code) {
    let normalized = code.replace(/from\s+['"](?:\.\.\/)*(?:src\/)?framework\/BasePage['"]/g, "from '../../src/framework/BasePage'").replace(/from\s+['"](?:\.\.\/)*(?:src\/)?framework\/CommonActions['"]/g, "from '../../src/framework/CommonActions'").replace(/from\s+['"](?:\.\.\/)*(?:src\/)?framework\/WaitHelpers['"]/g, "from '../../src/framework/WaitHelpers'").replace(/from\s+['"](?:\.\.\/)*(?:src\/)?utils\/logger['"]/g, "from '../../src/utils/logger'").replace(/waitFor\(\{\s*state:\s*['"]enabled['"]\s*\}\)/g, "waitFor({ state: 'visible' })").replace(/waitFor\(\{\s*state:\s*['"]disabled['"]\s*\}\)/g, "waitFor({ state: 'hidden' })").replace(/(\.locator\([^)]+\))(?!\.first\(\))\.waitFor\(/g, "$1.first().waitFor(");
    normalized = this.removeUnusedRelativeImports(normalized);
    if (/\bexpect\s*\(/.test(normalized) && !/import\s+\{[^}]*\bexpect\b[^}]*\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
      if (/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
        normalized = normalized.replace(/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/, (_match, imports) => {
          const names = imports.split(",").map((name) => name.trim()).filter(Boolean);
          if (!names.includes("expect")) names.push("expect");
          return `import { ${names.join(", ")} } from '@playwright/test'`;
        });
      } else {
        normalized = `import { expect } from '@playwright/test';
${normalized}`;
      }
    }
    if (/\bPage\b/.test(normalized) && !/import\s+\{[^}]*\bPage\b[^}]*\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
      if (/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
        normalized = normalized.replace(/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/, (_match, imports) => {
          const names = imports.split(",").map((name) => name.trim()).filter(Boolean);
          if (!names.includes("Page")) names.push("Page");
          return `import { ${names.join(", ")} } from '@playwright/test'`;
        });
      } else {
        normalized = `import { Page } from '@playwright/test';
${normalized}`;
      }
    }
    return normalized.replace(
      /page\.goto\(([^,\n]+)\)/g,
      "page.goto($1, { waitUntil: 'domcontentloaded', timeout: 30000 })"
    );
  }
  removeUnusedRelativeImports(code) {
    const lines = code.split(/\r?\n/);
    const body = lines.filter((line2) => !/^\s*import\s+/.test(line2)).join("\n");
    return lines.filter((line2) => {
      const match = line2.match(/^\s*import\s+\{([^}]+)\}\s+from\s+['"](\.\/[^'"]+)['"];?\s*$/);
      if (!match) return true;
      const importedNames = match[1].split(",").map((name) => name.trim().split(/\s+as\s+/i).pop() || "").filter(Boolean);
      return importedNames.some((name) => new RegExp(`\\b${name}\\b`).test(body));
    }).join("\n");
  }
  async planGeneratedWrites(supportFiles, specFileName, plan) {
    const reserved = /* @__PURE__ */ new Set();
    const supportFileNames = {};
    for (const fileName of Object.keys(supportFiles)) {
      const targetDir = this.isLocatorSupportFile(fileName, supportFiles[fileName]) ? this.locatorsDir : this.pagesDir;
      supportFileNames[fileName] = await this.generatedFileNameForScenario(targetDir, fileName, reserved, plan);
    }
    return {
      supportFileNames,
      specFileName: await this.generatedFileNameForScenario(this.testsDir, specFileName, reserved, plan)
    };
  }
  async generatedFileNameForScenario(targetDir, fileName, reserved, plan) {
    const ext = fileName.endsWith(".spec.ts") ? ".spec.ts" : import_path4.default.extname(fileName);
    const base = this.shortGeneratedBaseName(import_path4.default.basename(fileName, ext), ext, "");
    const candidate = `${base}${ext}`;
    const candidatePath = import_path4.default.join(targetDir, candidate);
    if (!reserved.has(candidatePath) && await (0, import_fs_extra3.pathExists)(candidatePath) && !await this.indexedToDifferentScenario(candidatePath, plan)) {
      reserved.add(candidatePath);
      return candidate;
    }
    return this.uniqueGeneratedFileName(targetDir, fileName, reserved);
  }
  async indexedToDifferentScenario(filePath, plan) {
    const index = await this.readArtifactIndex();
    const relative = this.relativePath(filePath);
    const scenarioKey = this.scenarioKey(plan);
    return index.entries.some((entry) => entry.scenarioKey !== scenarioKey && (entry.specPath === relative || entry.supportFiles.includes(relative)));
  }
  async uniqueGeneratedFileName(targetDir, fileName, reserved) {
    const ext = fileName.endsWith(".spec.ts") ? ".spec.ts" : import_path4.default.extname(fileName);
    const base = this.shortGeneratedBaseName(import_path4.default.basename(fileName, ext), ext, "");
    let candidate = `${base}${ext}`;
    let index = 2;
    let candidatePath = import_path4.default.join(targetDir, candidate);
    while (reserved.has(candidatePath)) {
      const suffix = `_${index}`;
      candidate = `${this.shortGeneratedBaseName(import_path4.default.basename(fileName, ext), ext, suffix)}${suffix}${ext}`;
      candidatePath = import_path4.default.join(targetDir, candidate);
      index += 1;
    }
    reserved.add(candidatePath);
    return candidate;
  }
  shortGeneratedBaseName(baseName, ext, suffix) {
    const maxVisibleLength = 16;
    const maxBaseLength = Math.max(1, maxVisibleLength - ext.length - suffix.length);
    const cleanBaseName = baseName.replace(/[^a-zA-Z0-9]/g, "");
    if (/Locators$/i.test(cleanBaseName)) {
      const suffixText = "Locators";
      const scenarioBase = cleanBaseName.replace(/Locators$/i, "");
      return `${this.compactFileBase([scenarioBase], maxBaseLength - suffixText.length)}${suffixText}`;
    }
    if (/Page$/i.test(cleanBaseName)) {
      const suffixText = "Page";
      const scenarioBase = cleanBaseName.replace(/Page$/i, "");
      return `${this.compactFileBase([scenarioBase], maxBaseLength - suffixText.length)}${suffixText}`;
    }
    return this.compactFileBase([cleanBaseName], maxBaseLength);
  }
  isShortVisibleFileName(file) {
    return import_path4.default.basename(file).length <= 16;
  }
  remapSupportFiles(files, fileNameMap) {
    return Object.fromEntries(
      Object.entries(files).map(([fileName, content]) => [
        fileNameMap[fileName] ?? fileName,
        this.rewriteGeneratedImportsForUniqueFiles(content, fileNameMap)
      ])
    );
  }
  rewriteGeneratedImportsForUniqueFiles(code, fileNameMap) {
    return code.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote, importName) => {
      const normalizedImport = String(importName).replace(/\\/g, "/");
      if (normalizedImport.includes("src/framework") || normalizedImport.includes("src/utils")) return match;
      const oldFileName = this.toSupportFileName(normalizedImport);
      const newFileName = fileNameMap[oldFileName];
      if (!newFileName || newFileName === oldFileName) return match;
      const importDir = import_path4.default.posix.dirname(normalizedImport);
      const newBase = import_path4.default.basename(newFileName, import_path4.default.extname(newFileName));
      const isJson = oldFileName.endsWith(".json");
      const newImport = importDir === "." ? `./${newBase}${isJson ? ".json" : ""}` : `${importDir}/${newBase}${isJson ? ".json" : ""}`;
      return `from ${quote}${newImport}${quote}`;
    });
  }
  async writeSupportFiles(files) {
    for (const [fileName, content] of Object.entries(files)) {
      const isLocatorFile = this.isLocatorSupportFile(fileName, content);
      const targetDir = isLocatorFile ? this.locatorsDir : this.pagesDir;
      const normalizedContent = isLocatorFile ? content : this.addExecutionLogsToActions(this.normalizePageImports(content));
      const filePath = import_path4.default.join(targetDir, fileName);
      await (0, import_fs_extra3.writeFile)(filePath, normalizedContent);
      this.logger.info(`Generated support file at ${filePath}`);
    }
  }
  isLocatorSupportFile(fileName, content = "") {
    return /locator|loc\./i.test(fileName) || /\bexport\s+const\s+\w+Locators\b/.test(content) || /\bexport\s+type\s+\w+LocatorKey\b/.test(content);
  }
  normalizeSpecImports(code, supportFiles) {
    return code.replace(/from\s+['"](\.\.?\/[^'"]+)['"]/g, (_match, importName) => {
      const base = import_path4.default.basename(importName, import_path4.default.extname(importName));
      const fileName = this.toSupportFileName(importName);
      if (importName.includes("src/framework") || importName.includes("src/utils")) {
        return `from '${importName}'`;
      }
      if (!supportFiles[fileName]) return `from '${importName}'`;
      const folder = /locator/i.test(fileName) ? "locators" : "pages";
      return `from '../${folder}/${base}'`;
    });
  }
  normalizePageImports(code) {
    return code.replace(/from\s+['"](\.\.?\/[^'"]+)['"]/g, (_match, importName) => {
      if (importName.includes("src/framework") || importName.includes("src/utils")) {
        return `from '${importName}'`;
      }
      const base = import_path4.default.basename(importName, import_path4.default.extname(importName));
      const folder = /locator/i.test(importName) ? "../locators" : ".";
      return `from '${folder}/${base}'`;
    });
  }
  relativeImportsAreSatisfied(code, supportFiles) {
    const allCode = [code, ...Object.values(supportFiles)];
    return allCode.flatMap((content) => this.getRelativeImportNames(content)).every((importName) => {
      const normalized = importName.replace(/\\/g, "/");
      if (normalized.includes("src/framework") || normalized.includes("src/utils")) return true;
      if (normalized.startsWith("../src/") || normalized.startsWith("../../src/")) return true;
      const fileName = this.toSupportFileName(normalized);
      return Boolean(supportFiles[fileName]);
    });
  }
  supportFilesAreValid(supportFiles) {
    if (Object.keys(supportFiles).length === 0) return true;
    return Object.values(supportFiles).every((content) => {
      if (/```|\*\*/.test(content)) return false;
      if (!content.trim()) return false;
      return true;
    });
  }
  getRelativeImportNames(code) {
    return Array.from(code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)).map((match) => match[1]);
  }
  normalizeSpecCode(code) {
    if (!code) return code;
    let normalized = this.trimAfterFinalTestBlock(code).replace(
      /page\.goto\(([^,\n]+)\)/g,
      "page.goto($1, { waitUntil: 'domcontentloaded', timeout: 30000 })"
    );
    if (!/test\.setTimeout\(/.test(normalized)) {
      normalized = normalized.replace(
        /(test\([^\n]*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\r?\n)/,
        "$1  test.setTimeout(60000);\n"
      );
    }
    return normalized;
  }
  addExecutionLogsToSpec(code) {
    return code.replace(
      /^(\s*)await\s+test\.step\(\s*(['"`])([^'"`]+)\2\s*,\s*async\s*\(\)\s*=>\s*\{\s*$/gm,
      (line2, indent, _quote, title) => {
        const message = `\x1B[36m[STEP]\x1B[0m ${this.humanizeLogText(title)}`;
        return `${line2}
${indent}  console.log(${JSON.stringify(message)});`;
      }
    );
  }
  ensureMinimumTestTimeout(code, minimumMs = 6e4) {
    if (/test\.setTimeout\(\s*\d+\s*\)/.test(code)) {
      return code.replace(/test\.setTimeout\(\s*(\d+)\s*\)/, (_match, timeout) => {
        return `test.setTimeout(${Math.max(Number(timeout), minimumMs)})`;
      });
    }
    return code.replace(
      /(test\([^\n]*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\r?\n)/,
      `$1  test.setTimeout(${minimumMs});
`
    );
  }
  addExecutionLogsToActions(code) {
    const lines = code.split(/\r?\n/);
    const output = [];
    for (const line2 of lines) {
      const message = this.getActionLogMessage(line2);
      if (message) {
        const indent = line2.match(/^\s*/)?.[0] ?? "";
        output.push(`${indent}console.log(${JSON.stringify(message)});`);
      }
      output.push(line2);
    }
    return output.join("\n");
  }
  getActionLogMessage(line2) {
    const trimmed = line2.trim();
    if (!trimmed.startsWith("await ")) return void 0;
    const locatorKey = this.humanizeLogText(
      line2.match(/(?:this\.)?locators\.([A-Za-z_$][\w$]*)/)?.[1] ?? line2.match(/\b[A-Za-z_$][\w$]*Locators\.([A-Za-z_$][\w$]*)/)?.[1] ?? "target element"
    );
    if (/\.goto\(/.test(line2)) {
      return `\x1B[35m[ACTION]\x1B[0m Opening browser and navigating to application`;
    }
    if (/\.fill\(/.test(line2)) {
      return `\x1B[35m[ACTION]\x1B[0m Entering ${locatorKey}`;
    }
    if (/\.click\(/.test(line2)) {
      return `\x1B[35m[ACTION]\x1B[0m Clicking ${locatorKey}`;
    }
    if (/\.selectOption\(/.test(line2)) {
      return `\x1B[35m[ACTION]\x1B[0m Selecting ${locatorKey}`;
    }
    if (/\.press\(/.test(line2)) {
      return `\x1B[35m[ACTION]\x1B[0m Pressing key on ${locatorKey}`;
    }
    return void 0;
  }
  humanizeLogText(value) {
    return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }
  trimAfterFinalTestBlock(code) {
    const lastTestClose = Math.max(code.lastIndexOf("\n});"), code.lastIndexOf("\r\n});"));
    if (lastTestClose === -1) return code;
    return code.slice(0, lastTestClose + code.slice(lastTestClose).indexOf("});") + 3).trim();
  }
  normalizeKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
};

// src/agents/api/ApiAgent.ts
var import_node_fetch2 = __toESM(require("node-fetch"));
var import_fs_extra4 = require("fs-extra");
var import_path5 = __toESM(require("path"));
var ApiAgent = class {
  constructor() {
    this.logger = logger_default.getInstance();
    this.reportsDir = import_path5.default.resolve("reports", "api");
    this.generatedApiDir = import_path5.default.resolve("generated", "api");
    this.apiStatePath = import_path5.default.resolve("storage", "api-state.json");
  }
  async run(requestFile) {
    try {
      const raw = await (0, import_fs_extra4.readFile)(requestFile, "utf-8");
      const request = this.parseRequest(raw);
      const apiDefinitions = this.extractApiDefinitions(request);
      const reportPath = import_path5.default.join(this.reportsDir, "api-summary.json");
      const execution = await this.executeApiDefinitions(apiDefinitions, request);
      const failures = execution.results.filter((result) => !result.passed && !result.optional && !result.skipped);
      const maskedDefinitions = this.maskSecrets(apiDefinitions);
      await (0, import_fs_extra4.ensureDir)(this.reportsDir);
      await (0, import_fs_extra4.writeFile)(reportPath, JSON.stringify({
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        requestFile: import_path5.default.relative(process.cwd(), requestFile),
        count: apiDefinitions.length,
        executedCount: execution.results.filter((result) => !result.skipped).length,
        passed: failures.length === 0,
        failedCount: failures.length,
        apiDefinitions: maskedDefinitions,
        results: this.maskSecrets(execution.results),
        stateFile: import_path5.default.relative(process.cwd(), this.apiStatePath),
        note: apiDefinitions.length ? "API definitions were normalized and executable entries were run in sequence." : "No API definitions were found in the request file."
      }, null, 2));
      if (apiDefinitions.length) {
        await this.writeGeneratedApiManifest(requestFile, apiDefinitions);
        await this.writeApiState(requestFile, execution.state, execution.results);
      } else {
        await this.writeApiState(requestFile, { values: {}, responses: {} }, []);
      }
      if (failures.length > 0) {
        throw new FrameworkError(`API validation failed for ${failures.length} request(s)`, void 0, "API_FAIL");
      }
      this.logger.info(`ApiAgent: ${apiDefinitions.length} API definition(s) normalized, ${execution.results.filter((result) => !result.skipped).length} executed`);
      return reportPath;
    } catch (err) {
      if (err instanceof FrameworkError) {
        this.logger.error(err.message);
        throw err;
      }
      this.logger.error("ApiAgent failed", { error: err });
      throw new FrameworkError("API analysis failed", err, "API_FAIL");
    }
  }
  parseRequest(raw) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  extractApiDefinitions(request) {
    const rawDefinitions = this.extractApiDefinitionsFromValue(request);
    return rawDefinitions.map((definition, index) => this.normalizeApiDefinition(definition, index, request)).filter((definition) => Boolean(definition));
  }
  extractApiDefinitionsFromValue(value) {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.extractApiDefinitionsFromValue(entry));
    }
    if (!value || typeof value !== "object") {
      return [];
    }
    const record = value;
    if (this.hasEndpointShape(record)) {
      return [record];
    }
    const apiCollectionKeys = /* @__PURE__ */ new Set([
      "apiRequests",
      "apis",
      "api",
      "endpoints",
      "setup",
      "preconditions",
      "preConditions",
      "preSteps",
      "presteps",
      "dependsOn",
      "dependencies"
    ]);
    return Object.entries(record).filter(([key]) => apiCollectionKeys.has(key)).flatMap(([, entry]) => this.flattenApiDefinitions(entry));
  }
  flattenApiDefinitions(value) {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.flattenApiDefinitions(entry));
    }
    if (!value || typeof value !== "object") {
      return [];
    }
    const record = value;
    if (this.hasEndpointShape(record)) {
      return [record];
    }
    const nested = this.extractApiDefinitionsFromValue(record);
    if (nested.length) return nested;
    return Object.entries(record).flatMap(([name, entry]) => {
      if (!entry || typeof entry !== "object") return [];
      return [{ name, ...entry }];
    });
  }
  hasEndpointShape(value) {
    return ["url", "endpoint", "path", "link", "method"].some((key) => value[key] !== void 0) && !["locators", "testData", "credentials"].some((key) => value[key] !== void 0 && Object.keys(value).length === 1);
  }
  normalizeApiDefinition(definition, index, request) {
    const rawUrl = String(
      definition.url ?? definition.endpoint ?? definition.path ?? definition.link ?? ""
    ).trim();
    if (!rawUrl) return void 0;
    const method = String(definition.method ?? "GET").trim().toUpperCase();
    const url = this.resolveUrl(rawUrl, request);
    const headers = {
      ...this.normalizeAuthHeaders(definition),
      ...this.normalizeHeaders(definition.headers)
    };
    const expectedStatus = this.normalizeExpectedStatuses(definition);
    const timeoutMs = Number(definition.timeoutMs ?? definition.timeout ?? process.env.API_TIMEOUT_MS ?? 3e4);
    const requestExecute = request.apiExecute !== false && request.executeApis !== false;
    const execute = requestExecute && definition.execute !== false && definition.run !== false;
    const optional = Boolean(definition.optional ?? definition.continueOnFailure ?? request.apiContinueOnFailure);
    return {
      name: String(definition.name ?? `apiRequest${index + 1}`),
      method,
      url,
      headers,
      ...definition.body !== void 0 ? { body: definition.body } : {},
      ...definition.payload !== void 0 ? { body: definition.payload } : {},
      ...definition.data !== void 0 ? { body: definition.data } : {},
      ...expectedStatus.length ? { expectedStatus } : {},
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 3e4,
      execute,
      optional,
      extract: this.normalizeExtractMap(definition.extract ?? definition.extracts ?? definition.save)
    };
  }
  resolveUrl(rawUrl, request) {
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    const baseUrl = String(request.apiBaseUrl ?? request.applicationUrl ?? process.env.BASE_URL ?? "").trim();
    if (!baseUrl) return rawUrl;
    try {
      return new URL(rawUrl, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
    } catch {
      return rawUrl;
    }
  }
  normalizeHeaders(headers) {
    if (!headers || typeof headers !== "object") return {};
    return Object.fromEntries(
      Object.entries(headers).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => [key, String(value)])
    );
  }
  normalizeAuthHeaders(definition) {
    const auth = definition.auth ?? definition.authentication;
    const headers = {};
    const bearerToken = definition.bearerToken ?? definition.accessToken ?? definition.token;
    if (bearerToken !== void 0) {
      headers.Authorization = `Bearer ${String(bearerToken)}`;
    }
    const apiKey = definition.apiKey;
    if (apiKey !== void 0) {
      if (apiKey && typeof apiKey === "object") {
        const record2 = apiKey;
        headers[String(record2.headerName ?? record2.header ?? "x-api-key")] = String(record2.value ?? record2.key ?? "");
      } else {
        headers["x-api-key"] = String(apiKey);
      }
    }
    if (!auth || typeof auth !== "object") return headers;
    const record = auth;
    const type = String(record.type ?? "").toLowerCase();
    if (type === "bearer" || type === "token") {
      headers.Authorization = `Bearer ${String(record.token ?? record.value ?? "")}`;
    }
    if (type === "basic") {
      const username = String(record.username ?? record.user ?? "");
      const password = String(record.password ?? "");
      headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }
    if (type === "api-key" || type === "apikey") {
      headers[String(record.headerName ?? record.header ?? "x-api-key")] = String(record.value ?? record.key ?? "");
    }
    return headers;
  }
  normalizeExpectedStatuses(definition) {
    const raw = definition.expectedStatus ?? definition.expectedStatuses ?? definition.status ?? definition.statusCode;
    const values = Array.isArray(raw) ? raw : raw === void 0 ? [] : [raw];
    return values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 100 && value <= 599);
  }
  normalizeExtractMap(value) {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, pathValue]) => typeof pathValue === "string" && pathValue.trim().length > 0).map(([key, pathValue]) => [key, String(pathValue).trim()])
    );
  }
  async executeApiDefinitions(apiDefinitions, request) {
    const state = { values: {}, responses: {} };
    const results = [];
    for (const definition of apiDefinitions) {
      const resolvedDefinition = this.resolveApiDefinition(definition, request, state);
      const result = resolvedDefinition.execute ? await this.executeApiDefinition(resolvedDefinition, state) : this.skippedApiResult(resolvedDefinition);
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
      body: definition.body === void 0 ? void 0 : this.resolveTemplatesInObject(definition.body, request, state)
    };
  }
  async executeApiDefinition(definition, state) {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), definition.timeoutMs);
    try {
      const headers = { ...definition.headers };
      const body = this.prepareRequestBody(definition, headers);
      const response = await (0, import_node_fetch2.default)(definition.url, {
        method: definition.method,
        headers,
        ...body !== void 0 ? { body } : {},
        signal: controller.signal
      });
      const responseHeaders = this.responseHeadersToObject(response.headers);
      const responseText = await response.text();
      const responseBody = this.parseResponseBody(responseText, responseHeaders["content-type"]);
      const extracted = this.extractValues(definition.extract, responseBody);
      const expectedStatus = definition.expectedStatus?.length ? definition.expectedStatus : "2xx";
      const passed = Array.isArray(expectedStatus) ? expectedStatus.includes(response.status) : response.status >= 200 && response.status <= 299;
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
        extracted
      };
    } catch (err) {
      const expectedStatus = definition.expectedStatus?.length ? definition.expectedStatus : "2xx";
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
        requestBody: definition.body
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  skippedApiResult(definition) {
    return {
      name: definition.name,
      method: definition.method,
      url: definition.url,
      expectedStatus: definition.expectedStatus?.length ? definition.expectedStatus : "2xx",
      passed: true,
      skipped: true,
      optional: definition.optional,
      durationMs: 0,
      requestHeaders: definition.headers,
      requestBody: definition.body
    };
  }
  prepareRequestBody(definition, headers) {
    if (definition.body === void 0 || ["GET", "HEAD"].includes(definition.method)) return void 0;
    if (typeof definition.body === "string") return definition.body;
    const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === "content-type");
    if (!hasContentType) headers["content-type"] = "application/json";
    return JSON.stringify(definition.body);
  }
  responseHeadersToObject(headers) {
    const output = {};
    headers.forEach((value, key) => {
      output[key.toLowerCase()] = value;
    });
    return output;
  }
  parseResponseBody(responseText, contentType = "") {
    if (!responseText) return void 0;
    if (/json/i.test(contentType)) {
      try {
        return JSON.parse(responseText);
      } catch {
        return responseText;
      }
    }
    return responseText;
  }
  extractValues(extractMap, responseBody) {
    const extracted = {};
    for (const [key, selector] of Object.entries(extractMap)) {
      const value = this.readJsonPath(responseBody, selector);
      if (value !== void 0) extracted[key] = value;
    }
    return extracted;
  }
  readJsonPath(value, selector) {
    const normalized = selector.replace(/^\$\./, "").replace(/^\$/, "").trim();
    if (!normalized) return value;
    return normalized.split(".").reduce((current, segment) => {
      if (current === void 0 || current === null) return void 0;
      const arrayMatch = segment.match(/^([^\[]+)\[(\d+)\]$/);
      if (arrayMatch) {
        const record = current;
        const arrayValue = record[arrayMatch[1]];
        return Array.isArray(arrayValue) ? arrayValue[Number(arrayMatch[2])] : void 0;
      }
      if (/^\d+$/.test(segment) && Array.isArray(current)) return current[Number(segment)];
      if (typeof current === "object") return current[segment];
      return void 0;
    }, value);
  }
  captureApiState(state, definition, result) {
    state.responses[definition.name] = {
      status: result.status,
      passed: result.passed,
      body: result.responseBody,
      extracted: result.extracted ?? {}
    };
    if (result.extracted) {
      for (const [key, value] of Object.entries(result.extracted)) {
        state.values[key] = value;
        state.values[`${definition.name}.${key}`] = value;
      }
    }
  }
  resolveTemplatesInObject(value, request, state) {
    if (typeof value === "string") return this.resolveTemplate(value, request, state);
    if (Array.isArray(value)) return value.map((entry) => this.resolveTemplatesInObject(entry, request, state));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, this.resolveTemplatesInObject(entry, request, state)])
    );
  }
  resolveTemplate(value, request, state) {
    return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
      const resolved = this.lookupTemplateValue(String(expression).trim(), request, state);
      if (resolved === void 0 || resolved === null) return match;
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  lookupTemplateValue(expression, request, state) {
    if (/^env:/i.test(expression)) {
      return process.env[expression.replace(/^env:/i, "")];
    }
    const context = {
      request,
      testData: request.testData,
      credentials: request.credentials,
      api: state.responses,
      values: state.values,
      env: process.env
    };
    return state.values[expression] ?? this.readJsonPath(context, expression) ?? (request.testData && typeof request.testData === "object" ? this.readJsonPath(request.testData, expression) : void 0) ?? (request.credentials && typeof request.credentials === "object" ? this.readJsonPath(request.credentials, expression) : void 0) ?? process.env[expression];
  }
  async writeApiState(requestFile, state, results) {
    await (0, import_fs_extra4.ensureDir)(import_path5.default.dirname(this.apiStatePath));
    await (0, import_fs_extra4.writeFile)(this.apiStatePath, JSON.stringify(this.maskSecrets({
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      requestFile: import_path5.default.relative(process.cwd(), requestFile),
      values: state.values,
      responses: state.responses,
      results
    }), null, 2));
  }
  async writeGeneratedApiManifest(requestFile, apiDefinitions) {
    await (0, import_fs_extra4.ensureDir)(this.generatedApiDir);
    const baseName = import_path5.default.basename(requestFile, import_path5.default.extname(requestFile)).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "") || "api";
    const filePath = await this.uniquePath(import_path5.default.join(this.generatedApiDir, `${baseName}-api-manifest.json`));
    await (0, import_fs_extra4.writeFile)(filePath, JSON.stringify({
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      apiDefinitions: this.maskSecrets(apiDefinitions)
    }, null, 2));
    this.logger.info(`ApiAgent: generated API manifest at ${filePath}`);
  }
  maskSecrets(value, keyHint = "") {
    if (Array.isArray(value)) return value.map((entry) => this.maskSecrets(entry, keyHint));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.maskSecrets(entry, key)])
      );
    }
    if (typeof value !== "string") return value;
    if (this.isSecretKey(keyHint)) return "****";
    if (/^(bearer|basic)\s+[a-z0-9+/=._-]+$/i.test(value)) return value.replace(/^(\S+)\s+.+$/, "$1 ****");
    return value;
  }
  isSecretKey(key) {
    return /authorization|cookie|token|secret|password|api[-_]?key|client[-_]?secret/i.test(key);
  }
  async uniquePath(filePath) {
    if (!await (0, import_fs_extra4.pathExists)(filePath)) return filePath;
    const dir = import_path5.default.dirname(filePath);
    const ext = import_path5.default.extname(filePath);
    const base = import_path5.default.basename(filePath, ext);
    let index = 2;
    let candidate = import_path5.default.join(dir, `${base}_${index}${ext}`);
    while (await (0, import_fs_extra4.pathExists)(candidate)) {
      index += 1;
      candidate = import_path5.default.join(dir, `${base}_${index}${ext}`);
    }
    return candidate;
  }
};

// src/agents/execution/ExecutionAgent.ts
var import_child_process2 = require("child_process");
var import_path6 = __toESM(require("path"));

// src/utils/console-ui.ts
var RESET = "\x1B[0m";
var BOLD = "\x1B[1m";
var DIM = "\x1B[2m";
var FG_RED = "\x1B[31m";
var FG_GREEN = "\x1B[32m";
var FG_YELLOW = "\x1B[33m";
var FG_BLUE = "\x1B[34m";
var FG_MAGENTA = "\x1B[35m";
var FG_CYAN = "\x1B[36m";
var FG_WHITE = "\x1B[37m";
var BG_GREEN = "\x1B[42m";
var BG_RED = "\x1B[41m";
var BG_BLUE = "\x1B[44m";
var BG_MAGENTA = "\x1B[45m";
var BG_CYAN = "\x1B[46m";
var BG_YELLOW = "\x1B[43m";
var STAGE_COLORS = {
  1: { bg: BG_BLUE, fg: FG_BLUE, icon: "PLAN" },
  2: { bg: BG_MAGENTA, fg: FG_MAGENTA, icon: "API" },
  3: { bg: BG_CYAN, fg: FG_CYAN, icon: "GEN" },
  4: { bg: BG_YELLOW, fg: FG_YELLOW, icon: "SEC" },
  5: { bg: BG_CYAN, fg: FG_CYAN, icon: "RUN" },
  6: { bg: BG_YELLOW, fg: FG_YELLOW, icon: "HEAL" },
  7: { bg: BG_GREEN, fg: FG_GREEN, icon: "REPORT" }
};
function line(char = "-", length = 70) {
  return char.repeat(length);
}
function pipelineHeader(requestFile) {
  const fileName = requestFile.split(/[/\\]/).pop() || requestFile;
  console.log("");
  console.log(`${BOLD}${FG_CYAN}${line("=")}${RESET}`);
  console.log(`${BOLD}${FG_CYAN}  AI-PLAYWRIGHT AUTOMATION PIPELINE${RESET}`);
  console.log(`${BOLD}${FG_CYAN}${line("=")}${RESET}`);
  console.log(`${DIM}${FG_WHITE}  Request : ${fileName}${RESET}`);
  console.log(`${DIM}${FG_WHITE}  Time    : ${(/* @__PURE__ */ new Date()).toLocaleTimeString()}${RESET}`);
  console.log(`${BOLD}${FG_CYAN}${line("-")}${RESET}`);
  console.log("");
}
function stageStart(stageNum, name, description) {
  const colors = STAGE_COLORS[stageNum] || STAGE_COLORS[1];
  console.log("");
  console.log(`${BOLD}${colors.fg}${line("-")}${RESET}`);
  console.log(`${BOLD}${colors.bg}${FG_WHITE}  STAGE ${stageNum}  ${RESET} ${BOLD}${colors.fg} ${colors.icon}  ${name}${RESET}`);
  console.log(`${DIM}${FG_WHITE}  ${description}${RESET}`);
  console.log(`${BOLD}${colors.fg}${line("-")}${RESET}`);
}
function stagePass(stageNum, name, detail) {
  const colors = STAGE_COLORS[stageNum] || STAGE_COLORS[1];
  console.log(`${BOLD}${FG_GREEN}  PASS ${name} completed successfully${RESET}`);
  console.log(`${DIM}${FG_WHITE}     ${detail}${RESET}`);
  console.log(`${DIM}${colors.fg}${line(".", 40)}${RESET}`);
}
function stageFail(_stageNum, name, detail) {
  console.log(`${BOLD}${FG_RED}  FAIL ${name}${RESET}`);
  console.log(`${DIM}${FG_RED}     ${detail}${RESET}`);
  console.log("");
}
function banner(message, type = "info") {
  const colorMap = {
    info: FG_CYAN,
    success: FG_GREEN,
    error: FG_RED,
    warn: FG_YELLOW
  };
  console.log(`${BOLD}${colorMap[type]}${message}${RESET}`);
}
function executionLog(type, title, detail = "") {
  const colorMap = {
    info: FG_CYAN,
    action: FG_MAGENTA,
    success: FG_GREEN,
    warn: FG_YELLOW,
    error: FG_RED,
    heal: FG_BLUE,
    skip: FG_YELLOW
  };
  const labelMap = {
    info: "EXEC",
    action: "ACTION",
    success: "PASS",
    warn: "WARN",
    error: "FAIL",
    heal: "HEAL",
    skip: "SKIP"
  };
  const suffix = detail ? `${DIM}${FG_WHITE} - ${detail}${RESET}` : "";
  console.log(`${BOLD}${colorMap[type]}[${labelMap[type]}] ${title}${RESET}${suffix}`);
}
function pipelineSummary(passed, elapsedSeconds) {
  console.log("");
  console.log(`${BOLD}${FG_CYAN}${line("=")}${RESET}`);
  if (passed) {
    console.log(`${BOLD}${BG_GREEN}${FG_WHITE}  PIPELINE PASSED  ${RESET}  ${FG_GREEN}All stages completed successfully${RESET}`);
  } else {
    console.log(`${BOLD}${BG_RED}${FG_WHITE}  PIPELINE FAILED  ${RESET}  ${FG_RED}One or more stages failed${RESET}`);
  }
  console.log(`${DIM}${FG_WHITE}  Total time: ${elapsedSeconds}s${RESET}`);
  const cwd = process.cwd().replace(/\\/g, "/");
  console.log(`${DIM}${FG_WHITE}  HTML Report -> file:///${cwd}/reports/html/index.html${RESET}`);
  console.log(`${DIM}${FG_WHITE}  Test Results -> file:///${cwd}/reports/test-results/${RESET}`);
  console.log(`${DIM}${FG_WHITE}  Framework Logs -> file:///${cwd}/reports/logs/framework.log${RESET}`);
  console.log(`${BOLD}${FG_CYAN}${line("=")}${RESET}`);
  console.log("");
}

// src/agents/execution/ExecutionAgent.ts
var ExecutionAgent = class {
  constructor() {
    this.logger = logger_default.getInstance();
  }
  async run(specPath) {
    const absolutePath = import_path6.default.resolve(specPath);
    const relativePath = import_path6.default.relative(process.cwd(), absolutePath).split(import_path6.default.sep).join("/");
    this.logger.info(`ExecutionAgent: running spec ${absolutePath}`);
    executionLog("info", "Execution started", `Spec: ${relativePath}`);
    return new Promise((resolve, reject) => {
      const project = process.env.PLAYWRIGHT_PROJECT || "chrome";
      let modeFlag = "";
      if (process.env.PLAYWRIGHT_UI === "true") {
        modeFlag = " --ui";
      } else if (process.env.HEADLESS !== "true" && !process.env.CI) {
        modeFlag = " --headed";
      }
      const cmd = `npx playwright test "${relativePath}" --project=${project}${modeFlag}`;
      executionLog("action", "Opening browser", `Project: ${project}${modeFlag ? `, mode:${modeFlag.trim()}` : ""}`);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const configuredTimeout = Number(process.env.EXECUTION_TIMEOUT_MS ?? 8e4);
      const executionTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 8e4;
      const child = (0, import_child_process2.spawn)(cmd, { cwd: process.cwd(), shell: true, env: process.env });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, executionTimeout);
      child.stdout?.on("data", (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (chunk.trim()) this.logger.info(chunk.trimEnd());
      });
      child.stderr?.on("data", (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (chunk.trim()) this.logger.warn(chunk.trimEnd());
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        const frameworkError = new FrameworkError("Execution process failed to start", error, "EXEC_START_FAIL");
        executionLog("error", "Execution failed", "Playwright process could not start");
        reject(frameworkError);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        if (code !== 0 || timedOut) {
          const output = `${stdout}
${stderr}`;
          const failedSelector = this.extractFailedSelector(output);
          const failure = this.classifyFailure(output, failedSelector, timedOut);
          this.logger.error("Playwright execution failed", { exitCode: code, reason: failure.reason });
          if (failedSelector) {
            this.logger.warn(`ExecutionAgent: detected failed selector "${failedSelector}"`);
            executionLog("heal", "Healing candidate detected", failedSelector);
          } else {
            executionLog("skip", "Healing skipped", failure.reason);
          }
          const originalError = new Error(timedOut ? "Playwright execution timed out" : `Playwright exited with code ${code}`);
          const frameworkError = new FrameworkError("Execution failed", originalError, "EXEC_FAIL");
          frameworkError.output = output;
          frameworkError.failedSelector = failedSelector;
          frameworkError.failureKind = failure.kind;
          frameworkError.healingReason = failure.reason;
          reject(frameworkError);
        } else {
          this.logger.info("Playwright execution passed");
          executionLog("success", "Execution passed", "All browser steps completed");
          resolve({ passed: true, output: stdout });
        }
      });
    });
  }
  extractFailedSelector(output) {
    const quotedLocatorLineMatch = output.match(/Locator:\s+locator\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
    if (quotedLocatorLineMatch?.[2]) return this.cleanExtractedSelector(quotedLocatorLineMatch[2]);
    const quotedWaitingForLocatorMatch = output.match(/waiting for locator\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
    if (quotedWaitingForLocatorMatch?.[2]) return this.cleanExtractedSelector(quotedWaitingForLocatorMatch[2]);
    const quotedLocatorMatch = output.match(/locator\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
    if (quotedLocatorMatch?.[2]) return this.cleanExtractedSelector(quotedLocatorMatch[2]);
    const locatorLineMatch = output.match(/Locator:\s+locator\((.+?)\)\s*$/im);
    if (locatorLineMatch?.[1]) return this.cleanExtractedSelector(locatorLineMatch[1]);
    const waitingForLocatorMatch = output.match(/waiting for locator\((.+?)\)/i);
    if (waitingForLocatorMatch?.[1]) return this.cleanExtractedSelector(waitingForLocatorMatch[1]);
    const locatorMatch = output.match(/locator\((.+?)\)/);
    if (locatorMatch?.[1]) return this.cleanExtractedSelector(locatorMatch[1]);
    const rawLocatorLineMatch = output.match(/Locator:\s+(.+)/i);
    if (rawLocatorLineMatch?.[1]) return this.cleanExtractedSelector(rawLocatorLineMatch[1]);
    const frameworkActionMatch = output.match(/(?:FrameworkError:\s*)?(?:[a-zA-Z0-9_]+)\s+failed on\s+([^\r\n]+)/i);
    if (frameworkActionMatch?.[1]) return this.cleanExtractedSelector(frameworkActionMatch[1]);
    const waitingForMatch = output.match(/waiting for (?:locator\()?['"`]([^'"`\n]+)['"`]\)?/i);
    if (waitingForMatch?.[1]) return this.cleanExtractedSelector(waitingForMatch[1]);
    if (/ReferenceError|TypeError: Duplicate declaration|No tests found/i.test(output)) {
      return void 0;
    }
    return void 0;
  }
  cleanExtractedSelector(selector) {
    const trimmed = selector.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "").split(/\s+\{"(?:error|screenshot|screenshotError)"/)[0].trim();
    const unwrapped = /^(['"`])[\s\S]*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
    return unwrapped.replace(/\\+(['"`])/g, "$1").replace(/\\\\/g, "\\").trim();
  }
  classifyFailure(output, failedSelector, timedOut) {
    if (failedSelector) {
      return { kind: "locator", reason: `Locator failed: ${failedSelector}` };
    }
    if (timedOut) {
      return { kind: "timeout", reason: "Execution timed out before a failed selector was detected" };
    }
    if (/page\.goto:\s*url:\s*expected string,\s*got undefined/i.test(output)) {
      return {
        kind: "navigation",
        reason: "Navigation URL is missing; healing only fixes locators, not undefined applicationUrl values"
      };
    }
    if (/ReferenceError|TypeError: Duplicate declaration|No tests found/i.test(output)) {
      return {
        kind: "code",
        reason: "Generated test code failed before a locator action; healing only fixes locator failures"
      };
    }
    if (/SyntaxError/i.test(output) && /locator\(/i.test(output)) {
      return {
        kind: "locator",
        reason: "Invalid locator syntax detected; healing can update the selector"
      };
    }
    if (/browserType\.launch|Executable doesn't exist|Target page, context or browser has been closed/i.test(output)) {
      return {
        kind: "browser",
        reason: "Browser/runtime failed before a locator failure was detected"
      };
    }
    if (/expect\(|toBeVisible|toHaveText|toContainText|toBeEnabled/i.test(output)) {
      return {
        kind: "assertion",
        reason: "Assertion failed without a concrete selector value for healing"
      };
    }
    return {
      kind: "unknown",
      reason: "No failed selector was detected in Playwright output"
    };
  }
};

// src/agents/healing/HealingAgent.ts
var import_fs_extra5 = require("fs-extra");
var import_path7 = __toESM(require("path"));
var cheerio = __toESM(require("cheerio"));
var HealingAgent = class _HealingAgent {
  constructor() {
    this.logger = logger_default.getInstance();
    this.historyPath = import_path7.default.resolve("storage", "healing-history.json");
    this.promptPath = import_path7.default.resolve("prompts", "healing.txt");
  }
  async run(locatorFile, failedSelector, pageHtmlSnippet = "", targetRequirement = "Single Element (1 of 1)") {
    try {
      const normalizedFailedSelector = this.normalizeSelector(failedSelector);
      this.logger.info(`HealingAgent: healing selector "${normalizedFailedSelector}" in ${locatorFile}`);
      const pageContext = pageHtmlSnippet || await this.readBestPageContext();
      const inferredRequirement = this.inferTargetRequirement(normalizedFailedSelector, pageContext, targetRequirement);
      const codeHealing = await this.tryApplyCodeHealing(locatorFile, normalizedFailedSelector, pageContext);
      if (codeHealing) {
        await this.recordHistory(normalizedFailedSelector, codeHealing, locatorFile);
        this.logger.info(`HealingAgent: generated code updated successfully`);
        return codeHealing;
      }
      const inferredSuggestion = this.inferStableSelector(normalizedFailedSelector, pageContext);
      let promptSuggestion = "";
      if (!inferredSuggestion) {
        if (!Config.get().aiEnabled) {
          throw new FrameworkError("AI features are disabled and local DOM inference could not find a stable selector", void 0, "HEAL_AI_DISABLED");
        }
        const provider = LLMProviderFactory.getProvider();
        const template = await (0, import_fs_extra5.readFile)(this.promptPath, "utf-8");
        const frameworkApiDoc = await FrameworkApiExtractor.extractApiDocs();
        this.logger.info(`HealingAgent: using prompt template ${this.promptPath}`);
        const prompt = template.replace("{{FAILED_SELECTOR}}", normalizedFailedSelector).replace("{{PAGE_HTML_SNIPPET}}", pageContext || "Not available").replace("{{TARGET_REQUIREMENT}}", inferredRequirement).replace("{{FRAMEWORK_API}}", frameworkApiDoc);
        const rawSuggestion = await provider.generate(prompt);
        promptSuggestion = this.cleanSelector(rawSuggestion);
      }
      const suggestion = this.guardHealedSelector(normalizedFailedSelector, inferredSuggestion || promptSuggestion);
      this.validateSelector(suggestion);
      if (this.normalizeSelector(suggestion) === normalizedFailedSelector) {
        throw new FrameworkError("Healing suggestion did not change the failed selector", void 0, "HEAL_NOOP_SELECTOR");
      }
      this.logger.info(`HealingAgent: accepted ${inferredSuggestion ? "local inference" : "prompt output"} "${suggestion}"`);
      const locatorsDir = import_path7.default.resolve("generated", "locators");
      let updated = false;
      let targetJsonPath = "";
      if (await (0, import_fs_extra5.pathExists)(locatorsDir)) {
        const files = await (0, import_fs_extra5.readdir)(locatorsDir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          const filePath = import_path7.default.join(locatorsDir, file);
          try {
            const content = await (0, import_fs_extra5.readFile)(filePath, "utf-8");
            const data = JSON.parse(content);
            if (data && typeof data === "object" && data.locators && typeof data.locators === "object") {
              let fileUpdated = false;
              for (const [key, val] of Object.entries(data.locators)) {
                if (this.selectorsMatch(val, normalizedFailedSelector)) {
                  data.locators[key] = suggestion;
                  fileUpdated = true;
                  updated = true;
                }
              }
              if (fileUpdated) {
                await (0, import_fs_extra5.writeFile)(filePath, JSON.stringify(data, null, 2));
                targetJsonPath = filePath;
                this.logger.info(`HealingAgent: updated selector in local JSON ${filePath}`);
              }
            }
          } catch (e) {
          }
        }
      }
      if (!updated) {
        throw new FrameworkError("Failed selector was not found in any local locator JSON files", void 0, "HEAL_SELECTOR_NOT_FOUND");
      }
      await this.recordHistory(normalizedFailedSelector, suggestion, targetJsonPath);
      return suggestion;
    } catch (err) {
      this.logger.error("HealingAgent failed", { error: err });
      if (err instanceof FrameworkError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new FrameworkError(`Healing failed: ${message}`, err, "HEAL_FAIL");
    }
  }
  async findFileContainingSelector(preferredFile, failedSelector) {
    const scopedCandidates = await this.findCurrentRunLocatorFiles(preferredFile);
    for (const candidate of scopedCandidates) {
      const content = await (0, import_fs_extra5.readFile)(candidate, "utf-8");
      if (this.contentHasSelector(content, failedSelector)) return candidate;
    }
    try {
      const preferredContent = await (0, import_fs_extra5.readFile)(preferredFile, "utf-8");
      if (this.contentHasSelector(preferredContent, failedSelector)) return preferredFile;
    } catch {
    }
    const generatedDir = import_path7.default.resolve("generated");
    const candidates = await this.listTypeScriptFiles(generatedDir);
    for (const candidate of candidates) {
      const content = await (0, import_fs_extra5.readFile)(candidate, "utf-8");
      if (this.contentHasSelector(content, failedSelector)) return candidate;
    }
    return preferredFile;
  }
  async findCurrentRunLocatorFiles(entryFile) {
    const visited = /* @__PURE__ */ new Set();
    const orderedFiles = [];
    await this.collectRelativeImportGraph(import_path7.default.resolve(entryFile), visited, orderedFiles);
    return orderedFiles.filter((file) => /[\\/]locators[\\/]|locator/i.test(import_path7.default.basename(file)));
  }
  async collectRelativeImportGraph(file, visited, orderedFiles) {
    const absoluteFile = import_path7.default.resolve(file);
    if (visited.has(absoluteFile) || !await (0, import_fs_extra5.pathExists)(absoluteFile)) return;
    visited.add(absoluteFile);
    orderedFiles.push(absoluteFile);
    let content = "";
    try {
      content = await (0, import_fs_extra5.readFile)(absoluteFile, "utf-8");
    } catch {
      return;
    }
    for (const importName of this.getRelativeImportNames(content)) {
      const importedFile = await this.resolveRelativeImport(absoluteFile, importName);
      if (importedFile) {
        await this.collectRelativeImportGraph(importedFile, visited, orderedFiles);
      }
    }
  }
  getRelativeImportNames(code) {
    return Array.from(code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)).map((match) => match[1]).filter((importName) => !importName.includes("src/framework") && !importName.includes("src/utils"));
  }
  async resolveRelativeImport(fromFile, importName) {
    const basePath = import_path7.default.resolve(import_path7.default.dirname(fromFile), importName);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      import_path7.default.join(basePath, "index.ts")
    ];
    for (const candidate of candidates) {
      if (await (0, import_fs_extra5.pathExists)(candidate)) return candidate;
    }
    return void 0;
  }
  async tryApplyCodeHealing(preferredFile, failedSelector, pageContext) {
    if (!this.isStrictTextAssertionFailure(failedSelector, pageContext)) return void 0;
    const targetFile = await this.findGeneratedPageFile(preferredFile);
    if (!targetFile) return void 0;
    const content = await (0, import_fs_extra5.readFile)(targetFile, "utf-8");
    const updated = this.patchTextAssertionStrictMode(content);
    if (updated === content) return void 0;
    await (0, import_fs_extra5.writeFile)(targetFile, updated);
    return `code:${import_path7.default.basename(targetFile)}:strict-text-filter`;
  }
  isStrictTextAssertionFailure(failedSelector, pageContext) {
    return /strict mode violation|resolved to \d+ elements/i.test(pageContext) && /toContainText|Expected substring/i.test(pageContext) && Boolean(failedSelector);
  }
  async findGeneratedPageFile(preferredFile) {
    const contextFile = await this.extractPageFileFromLatestContext();
    if (contextFile) return contextFile;
    const generatedDir = import_path7.default.resolve("generated", "pages");
    try {
      const candidates = await this.listTypeScriptFiles(generatedDir);
      return candidates[0];
    } catch {
      return preferredFile.includes(`${import_path7.default.sep}pages${import_path7.default.sep}`) ? preferredFile : void 0;
    }
  }
  async extractPageFileFromLatestContext() {
    const context = await this.readLatestErrorContext();
    const match = context.match(/at\s+pages\\([^:\r\n]+\.ts):\d+/i) ?? context.match(/generated\\pages\\([^:\r\n]+\.ts):\d+/i);
    if (!match?.[1]) return void 0;
    const filePath = import_path7.default.resolve("generated", "pages", match[1]);
    try {
      await (0, import_fs_extra5.stat)(filePath);
      return filePath;
    } catch {
      return void 0;
    }
  }
  patchTextAssertionStrictMode(content) {
    let updated = content.replace(
      /await\s+expect\((this\.page\.locator\(this\.locators\[[^\]]+\]\))\)\.toContainText\(([^;\n]+)\);/g,
      (_match, locatorExpression, args) => {
        const valueArg = String(args).split(",")[0].trim();
        return `const matchingElement = ${locatorExpression}.filter({ hasText: ${valueArg} }).first();
    await expect(matchingElement).toContainText(${args});`;
      }
    );
    updated = updated.replace(
      /await\s+expect\((this\.locator\([^)]+\))\)\.toContainText\(([^;\n]+)\);/g,
      (_match, locatorExpression, args) => {
        const valueArg = String(args).split(",")[0].trim();
        return `const matchingElement = ${locatorExpression}.filter({ hasText: ${valueArg} }).first();
    await expect(matchingElement).toContainText(${args});`;
      }
    );
    return updated;
  }
  async listTypeScriptFiles(dir) {
    const entries = await (0, import_fs_extra5.readdir)(dir);
    const files = [];
    for (const entry of entries) {
      const fullPath = import_path7.default.join(dir, entry);
      const info = await (0, import_fs_extra5.stat)(fullPath);
      if (info.isDirectory()) {
        files.push(...await this.listTypeScriptFiles(fullPath));
      } else if (entry.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }
  cleanSelector(output) {
    const trimmed = output.trim();
    const fenced = trimmed.match(/^```(?:css|xpath)?\s*([\s\S]*?)\s*```$/i);
    return this.normalizeSelector((fenced ? fenced[1] : trimmed).trim().replace(/^['"]|['"]$/g, ""));
  }
  normalizeSelector(selector) {
    return selector.trim().replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/^['"]|['"]$/g, "");
  }
  selectorsMatch(a, b) {
    const normA = this.normalizeSelector(a).toLowerCase().replace(/[^a-z0-9]/g, "");
    const normB = this.normalizeSelector(b).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!normA || !normB) return false;
    return normA === normB || normA.includes(normB) || normB.includes(normA);
  }
  validateSelector(selector) {
    if (!selector) {
      throw new FrameworkError("Healing suggestion is empty", void 0, "HEAL_EMPTY");
    }
    if (selector.includes("\n") || selector.includes(";")) {
      throw new FrameworkError("Healing suggestion is not a single selector", void 0, "HEAL_INVALID_SELECTOR");
    }
  }
  guardHealedSelector(failedSelector, suggestion) {
    return suggestion;
  }
  contentHasSelector(content, selector) {
    return this.selectorReplacementPairs(selector, selector).some(({ oldValue }) => content.includes(oldValue));
  }
  replaceSelector(content, oldSelector, newSelector) {
    let updated = content;
    for (const pair of this.selectorReplacementPairs(oldSelector, newSelector)) {
      if (updated.includes(pair.oldValue)) {
        updated = updated.split(pair.oldValue).join(pair.newValue);
      }
    }
    return updated;
  }
  selectorReplacementPairs(oldSelector, newSelector) {
    const normalizedOldSelector = this.normalizeSelector(oldSelector);
    const normalizedNewSelector = this.normalizeSelector(newSelector);
    const pairs = [
      { oldValue: normalizedOldSelector, newValue: normalizedNewSelector },
      { oldValue: this.escapeForDoubleQuotedString(normalizedOldSelector), newValue: this.escapeForDoubleQuotedString(normalizedNewSelector) },
      { oldValue: this.escapeForSingleQuotedString(normalizedOldSelector), newValue: this.escapeForSingleQuotedString(normalizedNewSelector) },
      { oldValue: this.escapeForTemplateString(normalizedOldSelector), newValue: this.escapeForTemplateString(normalizedNewSelector) }
    ];
    return [
      ...pairs,
      ...this.xpathAttributeQuoteVariants(normalizedOldSelector, normalizedNewSelector)
    ];
  }
  xpathAttributeQuoteVariants(oldSelector, newSelector) {
    const match = oldSelector.match(/^(.*@\w+\s*=\s*)(['"]?)([^'"\]]+)\2(\].*)$/);
    if (!match) return [];
    const [, prefix, , value, suffix] = match;
    const oldVariants = [
      `${prefix}'${value}'${suffix}`,
      `${prefix}"${value}"${suffix}`,
      `${prefix}${value}${suffix}`
    ];
    return oldVariants.flatMap((oldValue) => [
      { oldValue, newValue: newSelector },
      { oldValue: this.escapeForDoubleQuotedString(oldValue), newValue: this.escapeForDoubleQuotedString(newSelector) },
      { oldValue: this.escapeForSingleQuotedString(oldValue), newValue: this.escapeForSingleQuotedString(newSelector) }
    ]);
  }
  escapeForDoubleQuotedString(value) {
    return JSON.stringify(value).slice(1, -1);
  }
  escapeForSingleQuotedString(value) {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }
  escapeForTemplateString(value) {
    return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  }
  async readLatestErrorContext() {
    const resultsDir = import_path7.default.resolve("test-results");
    try {
      const files = await this.listFilesByName(resultsDir, "error-context.md");
      const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      return newest ? await (0, import_fs_extra5.readFile)(newest.file, "utf-8") : "";
    } catch {
      return "";
    }
  }
  async readBestPageContext() {
    const [errorContext, domSnapshot] = await Promise.all([
      this.readLatestErrorContext(),
      this.readLatestDomSnapshot()
    ]);
    return [
      errorContext,
      domSnapshot ? `

--- DOM SNAPSHOT ---
${domSnapshot}` : ""
    ].filter(Boolean).join("\n");
  }
  async readLatestDomSnapshot() {
    const healingDir = import_path7.default.resolve("reports", "healing");
    try {
      const files = await this.listFilesMatching(healingDir, /^dom-.*\.html$/i);
      const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      if (!newest) return "";
      const html = await (0, import_fs_extra5.readFile)(newest.file, "utf-8");
      return this.sanitizeHtml(html);
    } catch {
      return "";
    }
  }
  sanitizeHtml(html) {
    if (!html) return "";
    let cleaned = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
    cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, "[SVG]");
    cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");
    cleaned = cleaned.replace(/\s+class=["'][^"']*["']/gi, "");
    cleaned = cleaned.replace(/\s+style=["'][^"']*["']/gi, "");
    cleaned = cleaned.replace(/\s+data-v-[a-zA-Z0-9_-]+(=["'][^"']*["'])?/gi, "");
    cleaned = cleaned.split("\n").map((line2) => line2.trim()).filter((line2) => line2.length > 0).join("\n");
    return cleaned.slice(0, 15e3);
  }
  async listFilesByName(dir, fileName) {
    const entries = await (0, import_fs_extra5.readdir)(dir);
    const files = [];
    for (const entry of entries) {
      const fullPath = import_path7.default.join(dir, entry);
      const info = await (0, import_fs_extra5.stat)(fullPath);
      if (info.isDirectory()) {
        files.push(...await this.listFilesByName(fullPath, fileName));
      } else if (entry === fileName) {
        files.push({ file: fullPath, mtimeMs: info.mtimeMs });
      }
    }
    return files;
  }
  async listFilesMatching(dir, pattern) {
    const entries = await (0, import_fs_extra5.readdir)(dir);
    const files = [];
    for (const entry of entries) {
      const fullPath = import_path7.default.join(dir, entry);
      const info = await (0, import_fs_extra5.stat)(fullPath);
      if (info.isDirectory()) {
        files.push(...await this.listFilesMatching(fullPath, pattern));
      } else if (pattern.test(entry)) {
        files.push({ file: fullPath, mtimeMs: info.mtimeMs });
      }
    }
    return files;
  }
  inferTargetRequirement(failedSelector, pageContext, fallback) {
    return fallback;
  }
  inferStableSelector(failedSelector, pageContext) {
    return this.inferFromDomContext(failedSelector, pageContext);
  }
  /** Static convenience method used by CommonActions to get a fallback selector without needing an instance. */
  static inferStableSelectorStatic(failedSelector, pageContext) {
    const agent = new _HealingAgent();
    return agent.inferStableSelector(failedSelector, pageContext);
  }
  inferFromDomContext(failedSelector, pageContext) {
    if (!pageContext) return void 0;
    return this.inferStableSelectorFromDomElements(failedSelector, pageContext);
  }
  inferStableSelectorFromDomElements(failedSelector, pageContext) {
    const candidates = this.extractDomCandidates(pageContext);
    if (!candidates.length) return void 0;
    const ranked = candidates.filter((candidate) => this.candidateMatchesSelectorIntent(candidate, failedSelector)).map((candidate) => ({
      candidate,
      score: this.scoreDomCandidate(candidate, failedSelector)
    })).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || a.candidate.order - b.candidate.order);
    for (const { candidate } of ranked) {
      const selector = this.selectorForElement(candidate);
      if (selector && this.normalizeSelector(selector) !== this.normalizeSelector(failedSelector)) return selector;
    }
    return void 0;
  }
  extractDomCandidates(pageContext) {
    const cheerioCandidates = this.extractDomCandidatesWithCheerio(pageContext);
    const regexCandidates = this.extractHtmlElementCandidates(pageContext);
    const ariaCandidates = this.extractAriaSnapshotCandidates(pageContext);
    const all = [...cheerioCandidates, ...regexCandidates, ...ariaCandidates];
    const uniq = /* @__PURE__ */ new Map();
    for (const c of all) {
      const key = `${c.tag}|${JSON.stringify(c.attributes)}|${c.text}`;
      if (!uniq.has(key)) uniq.set(key, c);
    }
    return Array.from(uniq.values());
  }
  /**
   * Parse the HTML using Cheerio and create stable element candidates.
   */
  extractDomCandidatesWithCheerio(pageContext) {
    if (!pageContext) return [];
    const $ = cheerio.load(pageContext);
    const candidates = [];
    const elements = $("*").toArray();
    elements.forEach((elem, idx) => {
      const tag = (elem.tagName || elem.name || "").toLowerCase();
      const attribs = elem.attribs || {};
      const text = $(elem).text().trim();
      candidates.push(this.createDomCandidate(
        tag,
        this.normalizeAttributes(attribs),
        text,
        void 0,
        "html",
        idx
      ));
    });
    return candidates;
  }
  /** Convert raw attribute map to lower‑cased string map */
  normalizeAttributes(raw) {
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== void 0 && v !== null) out[k.toLowerCase()] = v;
    }
    return out;
  }
  extractHtmlElementCandidates(pageContext) {
    return Array.from(pageContext.matchAll(/<(button|input|a|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi)).map((match, index) => {
      const tag = (match[1] || match[4] || "").toLowerCase();
      const attributes = this.parseAttributes(match[2] || match[5] || "");
      const text = this.stripHtml(match[3] || "");
      return this.createDomCandidate(tag, attributes, text, void 0, "html", index);
    });
  }
  extractAriaSnapshotCandidates(pageContext) {
    const lines = pageContext.split(/\r?\n/);
    const candidates = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line2 = lines[index];
      const match = line2.match(/^\s*-\s+(textbox|button|link|combobox|checkbox|radio|option|heading)\s*(?:"([^"]*)")?/i);
      if (!match) continue;
      const role = match[1].toLowerCase();
      const name = this.cleanAccessibleName(match[2] ?? "");
      const attributes = {};
      for (let lookAhead = index + 1; lookAhead < Math.min(lines.length, index + 8); lookAhead += 1) {
        const attributeMatch = lines[lookAhead].match(/^\s*-\s+\/?([a-zA-Z][\w-]*):\s*(.+?)\s*$/);
        if (attributeMatch) {
          attributes[attributeMatch[1].toLowerCase()] = this.cleanAccessibleName(attributeMatch[2]);
          continue;
        }
        if (/^\s*-\s+(textbox|button|link|combobox|checkbox|radio|option|heading)\b/i.test(lines[lookAhead])) {
          break;
        }
      }
      candidates.push(this.createDomCandidate(this.tagForAriaRole(role), attributes, name, role, "aria", index));
    }
    return candidates;
  }
  createDomCandidate(tag, attributes, text, role, source, order) {
    const searchText = [
      tag,
      role ?? "",
      text,
      Object.entries(attributes).map(([key, value]) => `${key} ${value}`).join(" ")
    ].join(" ").toLowerCase();
    return {
      tag,
      role,
      name: text,
      attributes,
      text,
      searchText,
      source,
      order
    };
  }
  tagForAriaRole(role) {
    const tags = {
      textbox: "input",
      button: "button",
      link: "a",
      combobox: "select",
      checkbox: "input",
      radio: "input",
      option: "option",
      heading: "h1"
    };
    return tags[role] ?? role;
  }
  cleanAccessibleName(value) {
    return value.replace(/\[[^\]]+\]$/g, "").replace(/^[^\w@./#-]+|[^\w@./#-]+$/g, "").replace(/\s+/g, " ").trim();
  }
  candidateMatchesSelectorIntent(candidate, failedSelector) {
    const failedWords = this.significantWords(failedSelector);
    if (!failedWords.length) return true;
    const candidateText = candidate.searchText.toLowerCase();
    return failedWords.some((word) => candidateText.includes(word));
  }
  scoreDomCandidate(candidate, failedSelector) {
    const failedWords = this.significantWords(failedSelector);
    const text = candidate.searchText;
    const matchCount = failedWords.filter((word) => text.includes(word)).length;
    if (failedWords.length > 0 && matchCount === 0) {
      return 0;
    }
    let score = matchCount * 2;
    if (!failedWords.length) {
      score += 1;
    }
    if (candidate.source === "html") score += 1;
    const tagMatch = failedSelector.match(/^\/\/([a-zA-Z0-9*_-]+)/);
    if (tagMatch) {
      const failedTag = tagMatch[1].toLowerCase();
      if (failedTag === candidate.tag.toLowerCase()) {
        score += 10;
      }
    }
    return score;
  }
  selectorForElement(candidate) {
    const { tag, attributes, text, role } = candidate;
    const stableAttributes = ["data-testid", "data-test", "aria-label", "name", "placeholder"];
    const xpathTag = tag && tag !== "*" ? tag : "*";
    for (const attribute of stableAttributes) {
      const value = attributes[attribute];
      if (value && !this.isDynamicValue(value)) {
        return `//${xpathTag}[@${attribute}='${this.escapeAttributeValue(value)}']`;
      }
    }
    const id = attributes.id;
    if (id && !this.isDynamicValue(id)) {
      return `//${xpathTag}[@id='${this.escapeAttributeValue(id)}']`;
    }
    let visibleText = text.trim().replace(/\s+/g, " ");
    visibleText = visibleText.replace(/\[SVG\]/gi, "").trim();
    if (visibleText && visibleText.length < 60 && !visibleText.includes("\n") && !visibleText.includes(";")) {
      const cleanText = visibleText.replace(/'/g, "").trim();
      if (cleanText) {
        return `//${xpathTag}[contains(normalize-space(), '${cleanText}')]`;
      }
    }
    return void 0;
  }
  parseAttributes(rawAttributes) {
    const attributes = {};
    for (const match of rawAttributes.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes[match[1].toLowerCase()] = match[3];
    }
    return attributes;
  }
  stripHtml(value) {
    return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  significantWords(value) {
    const stopWords = /* @__PURE__ */ new Set(["locator", "button", "input", "field", "element", "text", "type", "submit"]);
    return (value.match(/[a-zA-Z0-9]+/g) ?? []).map((word) => word.toLowerCase()).filter((word) => word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word));
  }
  isDynamicValue(value) {
    return /\b(\d{3,}|[a-f0-9]{8,}|react|mui|mat|headlessui|jss|css-|sc-)\b/i.test(value);
  }
  escapeAttributeValue(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  escapeCssIdentifier(value) {
    return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
  }
  isGenericSelector(selector) {
    return /^(button|input|select|textarea)(\[type=["']?\w+["']?\])?$/.test(selector) || /^button:has-text\(["']add to cart["']\)$/i.test(selector) || selector === "*";
  }
  async recordHistory(oldSelector, newSelector, file) {
    await (0, import_fs_extra5.ensureDir)(import_path7.default.dirname(this.historyPath));
    let history = [];
    try {
      const raw = await (0, import_fs_extra5.readFile)(this.historyPath, "utf-8");
      history = JSON.parse(raw);
    } catch {
    }
    history.push({
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      file: import_path7.default.basename(file),
      oldSelector,
      newSelector
    });
    await (0, import_fs_extra5.writeFile)(this.historyPath, JSON.stringify(history, null, 2));
  }
};

// src/agents/reporting/ReportingAgent.ts
var import_fs_extra6 = require("fs-extra");
var import_path8 = __toESM(require("path"));
var ReportingAgent = class {
  constructor() {
    this.logger = logger_default.getInstance();
    this.reportsDir = import_path8.default.resolve("reports");
  }
  async run() {
    try {
      await (0, import_fs_extra6.ensureDir)(this.reportsDir);
      await this.resetReportFolder("html");
      await this.resetReportFolder("allure-report");
      await this.resetReportFolder("allure-results");
      await this.resetReportFolder("test-results");
      await (0, import_fs_extra6.ensureDir)(import_path8.default.join(this.reportsDir, "screenshots"));
      await (0, import_fs_extra6.ensureDir)(import_path8.default.join(this.reportsDir, "videos"));
      await (0, import_fs_extra6.ensureDir)(import_path8.default.join(this.reportsDir, "logs"));
      await this.copyIfPresent("playwright-report", "html", "HTML report");
      await this.copyIfPresent("allure-report", "allure-report", "Allure report");
      await this.copyIfPresent("allure-results", "allure-results", "Allure results");
      await this.copyIfPresent("test-results", "test-results", "Playwright test results");
      const apiDocs = await FrameworkApiExtractor.extractApiDocs();
      const capabilities = apiDocs.split("\n").filter((line2) => line2.trim().startsWith("- `")).map((line2) => line2.replace("- `", "").split("`")[0]);
      const summary = {
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        frameworkCapabilitiesLoaded: capabilities.length,
        capabilities,
        htmlReport: "reports/html/index.html",
        allureReport: "reports/allure-report/index.html",
        allureResults: "reports/allure-results",
        testResults: "reports/test-results",
        apiReport: await this.optionalReportPath("api/api-summary.json"),
        securityReport: await this.optionalReportPath("security/security-summary.json")
      };
      await (0, import_fs_extra6.writeFile)(import_path8.default.join(this.reportsDir, "summary.json"), JSON.stringify(summary, null, 2));
      await this.generateExecutiveHtml(summary);
      this.logger.info("Report summary written to reports/summary.json");
    } catch (err) {
      this.logger.error("ReportingAgent failed", { error: err });
      throw new FrameworkError("Reporting failed", err, "REPORT_FAIL");
    }
  }
  async resetReportFolder(folderName) {
    const folderPath = import_path8.default.join(this.reportsDir, folderName);
    await (0, import_fs_extra6.ensureDir)(folderPath);
    await (0, import_fs_extra6.emptyDir)(folderPath);
  }
  async copyIfPresent(sourceFolder, targetFolder, label) {
    try {
      await (0, import_fs_extra6.copy)(import_path8.default.resolve(sourceFolder), import_path8.default.join(this.reportsDir, targetFolder), { overwrite: true });
      this.logger.info(`${label} copied to reports/${targetFolder}/`);
    } catch {
      this.logger.warn(`No ${sourceFolder}/ directory found; skipping ${label} copy`);
    }
  }
  async optionalReportPath(relativePath) {
    const reportPath = import_path8.default.join(this.reportsDir, relativePath);
    return await (0, import_fs_extra6.pathExists)(reportPath) ? `reports/${relativePath.replace(/\\/g, "/")}` : void 0;
  }
  async generateExecutiveHtml(summary) {
    const historyPath = import_path8.default.resolve("storage", "healing-history.json");
    let healingHistory = [];
    try {
      if (await (0, import_fs_extra6.pathExists)(historyPath)) {
        healingHistory = JSON.parse(await (0, import_fs_extra6.readFile)(historyPath, "utf-8"));
      }
    } catch (e) {
    }
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Automation Executive Summary</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
        .card { background: #ecf0f1; padding: 20px; border-radius: 8px; border-left: 5px solid #3498db; }
        .card.healing { border-left-color: #e74c3c; }
        .card.capabilities { border-left-color: #2ecc71; }
        h3 { margin-top: 0; color: #2c3e50; }
        .metric { font-size: 2.5em; font-weight: bold; color: #2980b9; }
        .metric.red { color: #e74c3c; }
        .metric.green { color: #2ecc71; }
        .list { list-style: none; padding: 0; }
        .list li { padding: 8px 0; border-bottom: 1px solid #ddd; font-size: 1.1em; }
        .list a { color: #3498db; text-decoration: none; font-weight: bold; }
        .list a:hover { text-decoration: underline; }
        .footer { margin-top: 30px; text-align: center; color: #7f8c8d; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>\u{1F680} AI Automation Executive Summary</h1>
        <p>Generated on: <strong>${new Date(summary.generatedAt).toLocaleString()}</strong></p>
        
        <div class="grid">
            <div class="card capabilities">
                <h3>Framework Intelligence</h3>
                <p>The Dynamic Test Engine successfully routed operations through the consolidated API architecture.</p>
                <div class="metric green">${summary.frameworkCapabilitiesLoaded}</div>
                <p>Advanced Capabilities Available</p>
            </div>
            
            <div class="card healing">
                <h3>AI Healing ROI</h3>
                <p>Number of broken UI tests successfully rescued dynamically by the AI during execution.</p>
                <div class="metric red">${healingHistory.length}</div>
                <p>Tests Saved from Failure</p>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h3>Utilized AI Capabilities</h3>
                <ul class="list">
                    ${summary.capabilities.map((c) => `<li>\u2714\uFE0F ${c}</li>`).join("")}
                </ul>
            </div>
            
            <div class="card">
                <h3>Deep Dive Reports</h3>
                <ul class="list">
                    <li><a href="html/index.html" target="_blank">View Detailed Playwright UI Report</a></li>
                    <li><a href="allure-report/index.html" target="_blank">View Allure Analytics Report</a></li>
                    ${summary.apiReport ? `<li><a href="${summary.apiReport.replace("reports/", "")}" target="_blank">View API Analysis</a></li>` : ""}
                    ${summary.securityReport ? `<li><a href="${summary.securityReport.replace("reports/", "")}" target="_blank">View Security Scan</a></li>` : ""}
                </ul>
            </div>
        </div>
        
        <div class="footer">
            <p>Powered by the Next-Generation AI Automation Framework</p>
        </div>
    </div>
</body>
</html>`;
    await (0, import_fs_extra6.writeFile)(import_path8.default.join(this.reportsDir, "executive-summary.html"), html);
    this.logger.info("Executive HTML Dashboard generated at reports/executive-summary.html");
  }
};

// src/agents/security/SecurityAgent.ts
var import_fs = require("fs");
var import_fs_extra7 = require("fs-extra");
var import_path9 = __toESM(require("path"));
var SecurityAgent = class {
  constructor() {
    this.logger = logger_default.getInstance();
    this.reportsDir = import_path9.default.resolve("reports", "security");
  }
  async run(targetPath = import_path9.default.resolve("generated")) {
    try {
      const absoluteTarget = import_path9.default.resolve(targetPath);
      const files = Array.from(new Set(await this.collectTypeScriptFiles(absoluteTarget)));
      const findings = files.flatMap((file) => this.scanFile(file));
      const criticalCount = findings.filter((finding) => finding.severity === "critical").length;
      const warningCount = findings.filter((finding) => finding.severity === "warning").length;
      const reportPath = import_path9.default.join(this.reportsDir, "security-summary.json");
      await (0, import_fs_extra7.ensureDir)(this.reportsDir);
      await (0, import_fs_extra7.writeFile)(reportPath, JSON.stringify({
        generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        targetPath: import_path9.default.relative(process.cwd(), absoluteTarget),
        scannedFiles: files.map((file) => import_path9.default.relative(process.cwd(), file)),
        passed: criticalCount === 0,
        criticalCount,
        warningCount,
        findings
      }, null, 2));
      if (criticalCount > 0) {
        throw new FrameworkError(`Security scan failed with ${criticalCount} critical finding(s)`, void 0, "SECURITY_FAIL");
      }
      this.logger.info(`SecurityAgent: scanned ${files.length} file(s), ${warningCount} warning(s)`);
      return { passed: true, reportPath, findings };
    } catch (err) {
      if (err instanceof FrameworkError) {
        this.logger.error(err.message);
        throw err;
      }
      this.logger.error("SecurityAgent failed", { error: err });
      throw new FrameworkError("Security scan failed", err, "SECURITY_FAIL");
    }
  }
  scanFile(file) {
    const relativeFile = import_path9.default.relative(process.cwd(), file);
    const content = this.readTextFile(file);
    const findings = [];
    this.addPatternFinding(findings, content, relativeFile, "critical", "no-ai-runtime-in-generated", /LLMProvider|GROQ_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|groq\.com\/openai|anthropic\.com\/v1\/messages/i, "Generated code must not call or configure AI providers.");
    this.addPatternFinding(findings, content, relativeFile, "critical", "no-shell-or-fs-in-generated", /from\s+['"](child_process|fs|fs-extra|node:fs|node:child_process)['"]|require\(['"](child_process|fs|fs-extra|node:fs|node:child_process)['"]\)/i, "Generated code must not use shell or filesystem APIs.");
    this.addPatternFinding(findings, content, relativeFile, "critical", "no-dynamic-code-execution", /\beval\s*\(|new\s+Function\s*\(/, "Generated code must not execute dynamic JavaScript.");
    this.addPatternFinding(findings, content, relativeFile, "critical", "no-secret-literals", /(api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i, "Generated code appears to contain a hard-coded secret.");
    this.addPatternFinding(findings, content, relativeFile, "critical", "no-focused-tests", /\b(?:test|describe)\.only\s*\(/, "Generated tests must not contain focused .only blocks.");
    if (/generated[\\/](tests|pages)[\\/]/i.test(file)) {
      this.addPatternFinding(findings, content, relativeFile, "critical", "framework-actions-only", /\bpage\.(?:goto|click|fill|press|selectOption|check|uncheck|hover|dragAndDrop|setInputFiles)\s*\(/, "Generated tests and page objects must use page-object methods and CommonActions, not low-level page actions.");
      this.addPatternFinding(findings, content, relativeFile, "critical", "no-direct-network-in-ui-code", /\b(?:fetch|axios\.\w+|http\.request|https\.request)\s*\(/, "Generated UI tests and page objects must not make direct network calls; use ApiAgent for API setup.");
      this.addPatternFinding(findings, content, relativeFile, "warning", "avoid-generic-method-names", /\basync\s+(?:clickElement|clearAndClickElement|fillElement|clearElement|click[A-Z][A-Za-z0-9]*Element)\s*\(/, "Generated methods should use user-friendly workflow names.");
      this.addPatternFinding(findings, content, relativeFile, "warning", "avoid-hard-waits", /\bwaitForTimeout\s*\(/, "Generated UI code should wait for states or assertions instead of fixed sleeps.");
      this.addPatternFinding(findings, content, relativeFile, "warning", "avoid-skipped-tests", /\b(?:test|describe)\.skip\s*\(/, "Generated tests should not silently skip coverage.");
    }
    if (/generated[\\/]locators[\\/]/i.test(file)) {
      this.addPatternFinding(findings, content, relativeFile, "warning", "avoid-fragile-locators", /nth-child|body\s*>\s*div|\/html\/body|\.css-[a-z0-9]+|\.jss\d+|\.sc-[a-z0-9]+/i, "Locator file contains selectors that are likely fragile.");
    }
    return findings;
  }
  readTextFile(file) {
    try {
      return (0, import_fs.readFileSync)(file, "utf-8");
    } catch {
      return "";
    }
  }
  addPatternFinding(findings, content, file, severity, ruleId, pattern, message) {
    if (!pattern.test(content)) return;
    findings.push({ severity, ruleId, file, message });
  }
  async collectTypeScriptFiles(targetPath, visited = /* @__PURE__ */ new Set()) {
    const info = await (0, import_fs_extra7.stat)(targetPath);
    if (info.isFile()) {
      return targetPath.endsWith(".ts") ? this.collectGeneratedImportGraph(targetPath, visited) : [];
    }
    const entries = await (0, import_fs_extra7.readdir)(targetPath);
    const files = [];
    for (const entry of entries) {
      const fullPath = import_path9.default.join(targetPath, entry);
      const entryInfo = await (0, import_fs_extra7.stat)(fullPath);
      if (entryInfo.isDirectory()) {
        files.push(...await this.collectTypeScriptFiles(fullPath));
      } else if (entry.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }
  async collectGeneratedImportGraph(file, visited) {
    const absoluteFile = import_path9.default.resolve(file);
    if (visited.has(absoluteFile)) return [];
    visited.add(absoluteFile);
    const files = [absoluteFile];
    const content = this.readTextFile(absoluteFile);
    const imports = Array.from(content.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)).map((match) => match[1]).filter((importName) => !importName.includes("src/framework") && !importName.includes("src/utils") && !importName.includes("src/locators"));
    for (const importName of imports) {
      const importedFile = await this.resolveRelativeImport(absoluteFile, importName);
      if (importedFile && importedFile.endsWith(".ts")) {
        files.push(...await this.collectGeneratedImportGraph(importedFile, visited));
      }
    }
    return files;
  }
  async resolveRelativeImport(fromFile, importName) {
    const basePath = import_path9.default.resolve(import_path9.default.dirname(fromFile), importName);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      import_path9.default.join(basePath, "index.ts")
    ];
    for (const candidate of candidates) {
      if (await (0, import_fs_extra7.pathExists)(candidate)) return candidate;
    }
    return void 0;
  }
};

// src/cli.ts
async function resolveFile(arg, fallbackDir = "requests") {
  if (import_path10.default.isAbsolute(arg)) return arg;
  const resolved = import_path10.default.resolve(arg);
  if (await (0, import_fs_extra8.pathExists)(resolved)) return resolved;
  return import_path10.default.resolve(fallbackDir, arg);
}
async function findLatestGeneratedSpec() {
  const testsDir = import_path10.default.resolve("generated", "tests");
  try {
    const entries = await (0, import_fs_extra8.readdir)(testsDir);
    const specs = await Promise.all(entries.filter((entry) => entry.endsWith(".spec.ts")).map(async (entry) => {
      const file = import_path10.default.join(testsDir, entry);
      const info = await (0, import_fs_extra8.stat)(file);
      return { file, mtimeMs: info.mtimeMs };
    }));
    const latest = specs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return latest?.file ?? import_path10.default.resolve("generated");
  } catch {
    return import_path10.default.resolve("generated");
  }
}
async function runPlanning(requestFile) {
  stageStart(1, "Planning Agent", "Converting requirement to automation plan");
  const planner = new PlanningAgent();
  const planPath = await planner.run(requestFile);
  stagePass(1, "Planning Agent", `Plan saved -> ${import_path10.default.basename(planPath)}`);
  return planPath;
}
async function runGeneration(planPath, executionError) {
  stageStart(3, "Generation Agent", "Generating Playwright code from plan");
  const generator = new GenerateAgent();
  const specPath = await generator.run(planPath, executionError);
  stagePass(3, "Generation Agent", `Spec generated -> ${import_path10.default.basename(specPath)}`);
  return specPath;
}
async function runApi(requestFile) {
  stageStart(2, "API Agent", "Executing API setup and validation from request JSON");
  const apiAgent = new ApiAgent();
  const reportPath = await apiAgent.run(requestFile);
  stagePass(2, "API Agent", `API report -> ${import_path10.default.relative(process.cwd(), reportPath)}`);
  return reportPath;
}
async function runSecurity(targetPath = "generated") {
  stageStart(4, "Security Agent", "Scanning generated code before execution");
  const securityAgent = new SecurityAgent();
  const result = await securityAgent.run(targetPath);
  stagePass(4, "Security Agent", `Security report -> ${import_path10.default.relative(process.cwd(), result.reportPath)}`);
  return result.reportPath;
}
async function runExecution(specPath) {
  stageStart(5, "Execution Agent", "Running Playwright tests in browser");
  const executor = new ExecutionAgent();
  const result = await executor.run(specPath);
  stagePass(5, "Execution Agent", "All tests passed");
  return result;
}
async function runHealing(specPath, failedSelector) {
  stageStart(6, "Healing Agent", `Healing failed selector: "${failedSelector}"`);
  const healer = new HealingAgent();
  const healedSelector = await healer.run(specPath, failedSelector);
  stagePass(6, "Healing Agent", `Healed -> "${healedSelector}"`);
  return healedSelector;
}
async function runExecutionWithHealing(planPath, specPath) {
  const logger = logger_default.getInstance();
  const maxCodeHealingAttempts = 3;
  let codeHealingAttempts = 0;
  const configuredHealingAttempts = Number(process.env.HEALING_MAX_ATTEMPTS ?? 3);
  const maxLocatorHealingAttempts = Number.isFinite(configuredHealingAttempts) && configuredHealingAttempts > 0 ? configuredHealingAttempts : 3;
  let locatorHealingAttempts = 0;
  let currentSpecPath = specPath;
  let lastError = null;
  while (true) {
    try {
      if (codeHealingAttempts === 0 && locatorHealingAttempts === 0) {
        await runExecution(currentSpecPath);
      } else {
        const attemptLabel = codeHealingAttempts > 0 ? `Code Fix ${codeHealingAttempts}/${maxCodeHealingAttempts}` : `Locator Heal ${locatorHealingAttempts}/${maxLocatorHealingAttempts}`;
        stageStart(6, "Re-Execution", `Retrying after recovery (${attemptLabel})`);
        const executor = new ExecutionAgent();
        await executor.run(currentSpecPath);
        stagePass(6, "Re-Execution", "Tests passed after recovery");
      }
      return;
    } catch (execErr) {
      lastError = execErr;
      const failedSelector = execErr.failedSelector;
      const errorOutput = String(execErr?.output ?? execErr?.message ?? "");
      if (!failedSelector && codeHealingAttempts < maxCodeHealingAttempts) {
        codeHealingAttempts += 1;
        stageStart(3, "Code Healing", `Execution failed with code error. Attempting codebase fix via GenerateAgent (${codeHealingAttempts}/${maxCodeHealingAttempts})...`);
        try {
          currentSpecPath = await runGeneration(planPath, errorOutput);
          await runSecurity(currentSpecPath);
          continue;
        } catch (genErr) {
          logger.error(`Code healing generation failed: ${genErr}`);
        }
      }
      if (failedSelector) {
        if (locatorHealingAttempts >= maxLocatorHealingAttempts) {
          stageFail(6, "Healing Agent", `Stopped after ${maxLocatorHealingAttempts} locator healing attempts. Last selector: "${failedSelector}"`);
          break;
        }
        locatorHealingAttempts += 1;
        executionLog("heal", "Execution paused for locator healing", failedSelector);
        await runHealing(currentSpecPath, failedSelector);
        executionLog("heal", "Healing complete; re-running same spec", import_path10.default.relative(process.cwd(), currentSpecPath));
        continue;
      }
      break;
    }
  }
  throw lastError;
}
async function runReporting() {
  stageStart(7, "Reporting Agent", "Aggregating reports, screenshots and videos");
  const reporter = new ReportingAgent();
  await reporter.run();
  stagePass(7, "Reporting Agent", "Reports ready in reports/ directory");
}
async function readPreconditionPlanPaths(planPath) {
  try {
    const raw = await (0, import_fs_extra8.readFile)(planPath, "utf-8");
    const plan = JSON.parse(raw);
    const references = [
      ...extractPlanPathReferences(plan.preconditions),
      ...extractPlanPathReferences(plan.preConditions),
      ...extractPlanPathReferences(plan.executionOrder)
    ];
    const unique = /* @__PURE__ */ new Set();
    for (const reference of references) {
      const resolved = await resolveReferencedPlanPath(reference, planPath);
      if (resolved && import_path10.default.resolve(resolved) !== import_path10.default.resolve(planPath)) {
        unique.add(import_path10.default.resolve(resolved));
      }
    }
    return Array.from(unique);
  } catch {
    return [];
  }
}
async function readPlan(planPath) {
  const raw = await (0, import_fs_extra8.readFile)(planPath, "utf-8");
  const plan = JSON.parse(raw);
  return plan && typeof plan === "object" ? plan : {};
}
function extractPlanPathReferences(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return entry;
    if (!entry || typeof entry !== "object") return [];
    const record = entry;
    const planPath = record.planPath ?? record.path ?? record.file;
    return typeof planPath === "string" ? [planPath] : [];
  });
}
async function resolveReferencedPlanPath(reference, fromPlanPath) {
  if (!reference.trim()) return void 0;
  if (import_path10.default.isAbsolute(reference)) return reference;
  const cwdCandidate = import_path10.default.resolve(reference);
  if (await (0, import_fs_extra8.pathExists)(cwdCandidate)) return cwdCandidate;
  const siblingCandidate = import_path10.default.resolve(import_path10.default.dirname(fromPlanPath), reference);
  if (await (0, import_fs_extra8.pathExists)(siblingCandidate)) return siblingCandidate;
  return cwdCandidate;
}
async function runPlanWithPreconditions(planPath, executedPlans) {
  const absolutePlanPath = import_path10.default.resolve(planPath);
  if (executedPlans.has(absolutePlanPath)) {
    executionLog("skip", "Precondition already executed", import_path10.default.relative(process.cwd(), absolutePlanPath));
    return;
  }
  executedPlans.add(absolutePlanPath);
  const plan = await readPlan(absolutePlanPath);
  const preconditionPlanPaths = await readPreconditionPlanPaths(absolutePlanPath);
  for (const preconditionPlanPath of preconditionPlanPaths) {
    executionLog("info", "Running precondition plan", import_path10.default.relative(process.cwd(), preconditionPlanPath));
    await runPlanWithPreconditions(preconditionPlanPath, executedPlans);
  }
  if (shouldSkipPlanExecution(plan)) {
    executionLog("skip", "Suite/controller plan completed", import_path10.default.relative(process.cwd(), absolutePlanPath));
    return;
  }
  const maxPlanRecoveryAttempts = Number(process.env.PLAN_RECOVERY_MAX_ATTEMPTS ?? 1);
  let planRecoveryAttempts = 0;
  while (true) {
    const specPath = await runGeneration(absolutePlanPath);
    await runSecurity(specPath);
    try {
      await runExecutionWithHealing(absolutePlanPath, specPath);
      return;
    } catch (err) {
      if (planRecoveryAttempts >= maxPlanRecoveryAttempts || !await tryApplyPlanRecovery(absolutePlanPath, err)) {
        throw err;
      }
      planRecoveryAttempts += 1;
      executionLog("heal", "Plan updated with missing setup recovery", import_path10.default.relative(process.cwd(), absolutePlanPath));
    }
  }
}
function shouldSkipPlanExecution(plan) {
  return Boolean(plan.suite || plan.skipExecution || plan.controller) || (!Array.isArray(plan.steps) || plan.steps.length === 0);
}
async function tryApplyPlanRecovery(planPath, err) {
  if (process.env.PLAN_RECOVERY === "false") return false;
  const plan = await readPlan(planPath);
  if (shouldSkipPlanExecution(plan)) return false;
  const recoverySteps = await inferRecoverySteps(plan, err);
  if (!recoverySteps.length) return false;
  const existingSteps = Array.isArray(plan.steps) ? plan.steps : [];
  const uniqueRecoverySteps = recoverySteps.filter((step) => !hasEquivalentStep(existingSteps, step));
  if (!uniqueRecoverySteps.length) return false;
  const insertIndex = existingSteps.findIndex((step, index) => {
    if (index === 0 && String(step?.action ?? "").toLowerCase() === "navigate") return false;
    return true;
  });
  const safeInsertIndex = insertIndex === -1 ? existingSteps.length : insertIndex;
  const nextSteps = [
    ...existingSteps.slice(0, safeInsertIndex),
    ...uniqueRecoverySteps,
    ...existingSteps.slice(safeInsertIndex)
  ].map((step, index) => ({ ...step, step: index + 1 }));
  const nextPlan = {
    ...plan,
    steps: nextSteps,
    setupSteps: [
      ...Array.isArray(plan.setupSteps) ? plan.setupSteps : [],
      ...uniqueRecoverySteps
    ],
    recoveryHistory: [
      ...Array.isArray(plan.recoveryHistory) ? plan.recoveryHistory : [],
      {
        recoveredAt: (/* @__PURE__ */ new Date()).toISOString(),
        reason: recoveryReason(err),
        steps: uniqueRecoverySteps
      }
    ]
  };
  await (0, import_fs_extra8.writeFile)(planPath, JSON.stringify(nextPlan, null, 2));
  return true;
}
async function inferRecoverySteps(plan, err) {
  const output = String(err?.output ?? "");
  const failedSelector = String(err?.failedSelector ?? "");
  const reason = String(err?.healingReason ?? "");
  const message = String(err?.message ?? "");
  const combinedFailure = `Error Message: ${message}
Failed Selector: ${failedSelector}
Healing Reason: ${reason}
Playwright Logs:
${output}`.trim();
  if (Config.get().aiEnabled) {
    try {
      const provider = LLMProviderFactory.getProvider();
      const frameworkApi = await FrameworkApiExtractor.extractApiDocs();
      const prompt = `You are an AI Playwright Test Recovery Agent.
We are running a test plan, but it failed with the following execution error.
We need to inject recovery setup steps (like clicking a modal close button, logging in, or navigating to the correct tab) at the start of the plan to allow it to recover and proceed.

AVAILABLE FRAMEWORK ACTIONS (MUST USE THESE):
${frameworkApi}

CURRENT PLAN:
${JSON.stringify(plan, null, 2)}

EXECUTION FAILURE:
${combinedFailure}

INSTRUCTIONS:
1. Analyze the failure and identify if there is a missing precondition or dynamic page state.
2. Suggest a JSON list of recovery steps to insert at the beginning of the steps list.
3. Each step MUST have:
   - "action": an action from the AVAILABLE FRAMEWORK ACTIONS above (e.g. "clickAction", "smartInput", "alertAction", etc.)
   - "target": a selector or locator key from the locators map
   - "value": (optional) value to enter for fill/select
   - "expectedResult": description of what this step achieves
   - "actionType": the specific method to call (e.g. "clearAndEnter")
4. If no recovery steps are possible or needed, return an empty list: [].
5. Respond ONLY with the JSON array. Do not include markdown code block formatting (fences) or explanations.

Example response format:
[
  {
    "action": "clickAction",
    "actionType": "conditional",
    "target": "//*[@id='close-popup']",
    "expectedResult": "Close any blocking modal popup"
  }
]`;
      const responseText = await provider.generate(prompt);
      const cleaned = responseText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
      if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          logger_default.getInstance().info(`CLI: Dynamic LLM reasoning suggested ${parsed.length} plan recovery steps`);
          return parsed;
        }
      }
    } catch (llmErr) {
      logger_default.getInstance().warn(`CLI: LLM plan recovery reasoning failed: ${llmErr}. Falling back to rule-based recovery.`);
    }
  }
  const steps = [];
  const combined = `${output}
${failedSelector}
${reason}
${message}`.toLowerCase();
  const locators = plan.locators && typeof plan.locators === "object" ? plan.locators : {};
  if (/intercepts pointer events|modal|dialog|popup|overlay|blocked|not receiving pointer/i.test(combined)) {
    const closeKey = Object.keys(locators).find(
      (key) => /close|dismiss|skip|cancel|hide/i.test(key)
    );
    if (closeKey) {
      steps.push({
        action: "clickIfVisible",
        target: closeKey,
        optional: true,
        recovered: true,
        expectedResult: "Blocking dialog or popup is closed"
      });
    }
  }
  if (/disabled|validation|required|invalid/i.test(combined)) {
    const testData = plan.testData && typeof plan.testData === "object" ? plan.testData : {};
    Object.keys(locators).forEach((key) => {
      const isField = /field|input|text|email|pass/i.test(key);
      const hasValue = testData[key] !== void 0;
      const stepExists = Array.isArray(plan.steps) && plan.steps.some((s) => String(s?.target).toLowerCase() === key.toLowerCase());
      if (isField && hasValue && !stepExists) {
        steps.push({
          action: "fill",
          target: key,
          value: String(testData[key]),
          recovered: true,
          expectedResult: `Field ${key} is filled`
        });
      }
    });
  }
  if (/timeout|waiting for|not visible|locator failed/i.test(combined)) {
    const targetKey = Object.keys(locators).find((key) => {
      const isMenu = /menu|link|tab|nav|button/i.test(key);
      const stepExists = Array.isArray(plan.steps) && plan.steps.some((s) => String(s?.target).toLowerCase() === key.toLowerCase());
      return isMenu && !stepExists;
    });
    if (targetKey) {
      steps.push({
        action: "click",
        target: targetKey,
        recovered: true,
        expectedResult: `Navigate to target using ${targetKey}`
      });
    }
  }
  return steps;
}
function hasEquivalentStep(steps, candidate) {
  const candidateAction = normalizeKey(candidate.action);
  const candidateTarget = normalizeKey(candidate.target);
  return steps.some((step) => normalizeKey(String(step?.action ?? "")) === candidateAction && normalizeKey(String(step?.target ?? "")) === candidateTarget);
}
function recoveryReason(err) {
  return String(err?.healingReason ?? err?.message ?? "Execution failure");
}
function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
async function runFullPipeline(requestFile) {
  const startTime = Date.now();
  pipelineHeader(requestFile);
  Config.get();
  logger_default.getInstance().info("Initializing Dynamic Framework Capabilities...");
  const apiDocs = await FrameworkApiExtractor.extractApiDocs();
  const capabilityCount = apiDocs.split("\n").filter((line2) => line2.includes("- `")).length;
  logger_default.getInstance().info(`Successfully extracted ${capabilityCount} dynamic framework actions from CommonActions.ts`);
  const planPath = await runPlanning(requestFile);
  await runApi(requestFile);
  let executionError;
  try {
    await runPlanWithPreconditions(planPath, /* @__PURE__ */ new Set());
  } catch (execErr) {
    executionError = execErr;
  }
  await runReporting();
  const elapsed = ((Date.now() - startTime) / 1e3).toFixed(1);
  pipelineSummary(!executionError, elapsed);
  if (executionError) {
    throw executionError;
  }
}
async function predetectEnvironment(args, stage) {
  try {
    let fileToRead = "";
    if (args[0] && args[0].endsWith(".json")) {
      fileToRead = await resolveFile(args[0], stage === "generate" || stage === "execute" ? "storage/plans" : "requests");
    }
    if (fileToRead && await (0, import_fs_extra8.pathExists)(fileToRead)) {
      const raw = await (0, import_fs_extra8.readFile)(fileToRead, "utf-8");
      const parsed = JSON.parse(raw);
      const envName = parsed.environment ?? parsed.env;
      if (typeof envName === "string" && envName.trim()) {
        process.env.ENVIRONMENT = envName.trim();
      }
    }
  } catch {
  }
}
async function getFilesFromTarget(targetPath, extensions, fallbackDir = "requests") {
  const resolved = await resolveFile(targetPath, fallbackDir);
  if (!await (0, import_fs_extra8.pathExists)(resolved)) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }
  const info = await (0, import_fs_extra8.stat)(resolved);
  if (info.isDirectory()) {
    const entries = await (0, import_fs_extra8.readdir)(resolved);
    const files = [];
    for (const entry of entries) {
      const fullPath = import_path10.default.join(resolved, entry);
      const entryStat = await (0, import_fs_extra8.stat)(fullPath);
      if (entryStat.isFile() && extensions.some((ext) => entry.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files.sort();
  }
  return [resolved];
}
(async () => {
  const logger = logger_default.getInstance();
  let stage = process.env.AI_STAGE || "full";
  let args = process.argv.slice(2);
  if (args[0]) {
    const candidate = args[0].toLowerCase();
    const subcommands = ["all", "plan", "generate", "execute", "api", "security", "heal", "report"];
    if (subcommands.includes(candidate)) {
      stage = candidate === "all" ? "full" : candidate;
      args = args.slice(1);
    }
  }
  try {
    await predetectEnvironment(args, stage);
    Config.get();
    switch (stage) {
      case "plan": {
        if (!args[0]) {
          banner("Usage: npm run plan <request-file-or-folder>", "error");
          process.exit(1);
        }
        const files = await getFilesFromTarget(args[0], [".json"], "requests");
        try {
          const plansDir = import_path10.default.resolve("storage", "plans");
          if (await (0, import_fs_extra8.pathExists)(plansDir)) {
            await (0, import_fs_extra8.remove)(plansDir);
          }
          const indexFile = import_path10.default.resolve("generated", ".artifact-index.json");
          if (await (0, import_fs_extra8.pathExists)(indexFile)) {
            await (0, import_fs_extra8.remove)(indexFile);
          }
        } catch {
        }
        for (const file of files) {
          const planPath = await runPlanning(file);
          banner(`
  Plan output: ${planPath}
`, "success");
        }
        break;
      }
      case "generate": {
        if (!args[0]) {
          banner("Usage: npm run generate <plan-file-or-folder>", "error");
          process.exit(1);
        }
        const files = await getFilesFromTarget(args[0], [".json"], "storage/plans");
        for (const file of files) {
          const specPath = await runGeneration(file);
          banner(`
  Spec output: ${specPath}
`, "success");
        }
        break;
      }
      case "api": {
        if (!args[0]) {
          banner("Usage: npm run api <request-file-or-folder>", "error");
          process.exit(1);
        }
        const files = await getFilesFromTarget(args[0], [".json"], "requests");
        for (const file of files) {
          const reportPath = await runApi(file);
          banner(`
  API report: ${reportPath}
`, "success");
        }
        break;
      }
      case "security": {
        const targetPath = args[0] ? await resolveFile(args[0], "generated/tests") : await findLatestGeneratedSpec();
        const reportPath = await runSecurity(targetPath);
        banner(`
  Security report: ${reportPath}
`, "success");
        break;
      }
      case "execute": {
        if (!args[0]) {
          banner("Usage: npm run execute <spec-file-or-folder>", "error");
          process.exit(1);
        }
        const files = await getFilesFromTarget(args[0], [".spec.ts", ".ts"], "generated/tests");
        for (const file of files) {
          const specBase = import_path10.default.basename(file, ".spec.ts");
          const planCandidates = [
            import_path10.default.resolve("storage", "plans", `${specBase}Plan.json`),
            import_path10.default.resolve("storage", "plans", `${specBase}_2Plan.json`),
            import_path10.default.resolve("storage", "plans", `${specBase}.json`)
          ];
          let planFile = "";
          for (const candidate of planCandidates) {
            if (await (0, import_fs_extra8.pathExists)(candidate)) {
              planFile = candidate;
              break;
            }
          }
          await runExecutionWithHealing(planFile, file);
        }
        break;
      }
      case "heal": {
        if (!args[0] || !args[1]) {
          banner("Usage: npm run heal <spec-file>.spec.ts <failed-selector>", "error");
          process.exit(1);
        }
        const specFile = await resolveFile(args[0], "generated/tests");
        await runHealing(specFile, args[1]);
        break;
      }
      case "report": {
        await runReporting();
        break;
      }
      case "full":
      default: {
        if (!args[0]) {
          banner("Usage: npm run ai-test <request-file-or-folder>", "error");
          process.exit(1);
        }
        const files = await getFilesFromTarget(args[0], [".json"], "requests");
        try {
          const plansDir = import_path10.default.resolve("storage", "plans");
          if (await (0, import_fs_extra8.pathExists)(plansDir)) {
            await (0, import_fs_extra8.remove)(plansDir);
          }
          const indexFile = import_path10.default.resolve("generated", ".artifact-index.json");
          if (await (0, import_fs_extra8.pathExists)(indexFile)) {
            await (0, import_fs_extra8.remove)(indexFile);
          }
        } catch {
        }
        for (const file of files) {
          await runFullPipeline(file);
        }
        break;
      }
    }
    process.exit(0);
  } catch (err) {
    if (err instanceof FrameworkError) {
      logger.error(`Pipeline aborted [${err.code}]: ${err.message}`);
    } else {
      logger.error(`Unexpected error: ${err.message}`);
    }
    process.exit(1);
  }
})();
