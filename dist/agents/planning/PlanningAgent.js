"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanningAgent = void 0;
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../../utils/logger"));
const LLMProvider_1 = require("../../framework/LLMProvider");
const FrameworkError_1 = require("../../framework/FrameworkError");
const Config_1 = require("../../framework/Config");
class PlanningAgent {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.storageDir = path_1.default.resolve('storage', 'plans');
        this.promptPath = path_1.default.resolve('prompts', 'planning.txt');
    }
    async run(requestFile) {
        try {
            const raw = await (0, fs_extra_1.readFile)(requestFile, 'utf-8');
            const req = this.parseRequirement(raw, requestFile);
            const normalizedReq = this.normalizeRequestShape({
                ...req,
                testData: this.mergeCredentialsIntoTestData(req),
                locators: this.normalizeLocatorAliases(req.locators),
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
        }
        catch (err) {
            this.logger.error('PlanningAgent failed', { error: err });
            throw new FrameworkError_1.FrameworkError('Planning failed', err);
        }
    }
    normalizeRequestShape(req) {
        const scenarioSource = req.requirement ?? req.scenario ?? req.testName ?? 'UnnamedScenario';
        const requirementItems = this.filterRelevantRequirements(this.requirementItems(scenarioSource), req);
        const normalizedRequirement = Array.isArray(req.requirement)
            ? requirementItems.length === 1
                ? requirementItems[0]
                : requirementItems
            : req.requirement;
        const scenario = this.scenarioText(req.scenario ?? normalizedRequirement ?? req.testName, 'UnnamedScenario');
        return {
            ...req,
            requirement: normalizedRequirement,
            scenario,
            requirements: requirementItems.length > 1 ? requirementItems : req.requirements,
        };
    }
    async buildPlan(req, overrides = {}) {
        const rawSteps = await this.createSteps(JSON.stringify(req, null, 2), req);
        const preconditions = await this.resolvePreconditions(req);
        const setupSteps = this.inlinePreconditionSteps(preconditions, rawSteps);
        const steps = this.reindexSteps([...setupSteps, ...rawSteps]);
        const scenario = this.scenarioText(req.requirement ?? req.scenario ?? req.testName, 'UnnamedScenario');
        const requirements = this.requirementItems(req.requirements ?? req.requirement ?? req.scenario ?? req.testName);
        const plan = {
            scenario,
            steps,
            env: req.environment ?? 'default',
            applicationUrl: req.applicationUrl ?? process.env.BASE_URL,
            priority: this.readPriority(req, 100),
            dependsOn: this.normalizeDependsOn(req.dependsOn ?? req.dependencies),
            ...overrides,
        };
        if (requirements.length > 1) {
            plan.requirements = requirements;
        }
        if (setupSteps.length > 0) {
            plan.setupSteps = setupSteps;
        }
        if (Object.keys(req.locators ?? {}).length > 0) {
            plan.locators = req.locators;
        }
        if (req.testData && typeof req.testData === 'object') {
            plan.testData = req.testData;
        }
        if (preconditions.length > 0) {
            plan.preconditions = preconditions;
            plan.executionOrder = [
                ...preconditions
                    .slice()
                    .sort((a, b) => a.priority - b.priority)
                    .map((precondition) => ({
                    type: 'precondition',
                    key: precondition.key,
                    priority: precondition.priority,
                    optional: precondition.optional,
                    planPath: precondition.planPath,
                })),
                { type: 'main', scenario: plan.scenario, priority: plan.priority },
            ];
        }
        return plan;
    }
    async writePlan(plan) {
        await (0, fs_extra_1.ensureDir)(this.storageDir);
        const existingPlan = await this.findMatchingPlan(plan);
        if (existingPlan) {
            this.logger.info(`PlanningAgent: reusing existing plan ${existingPlan}`);
            return existingPlan;
        }
        const planPath = await this.nextPlanPath(this.safeFileBase(plan.scenario));
        await (0, fs_extra_1.writeFile)(planPath, JSON.stringify(plan, null, 2));
        this.logger.info(`Plan written to ${planPath}`);
        return planPath;
    }
    async writeSuitePlan(req) {
        const testCases = this.extractTestCaseRequests(req)
            .sort((a, b) => this.readPriority(a, 100) - this.readPriority(b, 100));
        const plannedCases = [];
        for (const [index, testCase] of testCases.entries()) {
            const testCaseKey = String(testCase.key ?? testCase.id ?? `testCase${index + 1}`);
            const plan = await this.buildPlan(testCase, {
                testCase: true,
                testCaseKey,
                parentScenario: this.scenarioText(req.requirement ?? req.scenario, 'Generated suite'),
            });
            const planPath = await this.writePlan(plan);
            plannedCases.push({
                key: testCaseKey,
                scenario: this.scenarioText(plan.scenario, `Test case ${index + 1}`),
                priority: Number(plan.priority ?? this.readPriority(testCase, index + 1)),
                planPath,
                dependsOn: this.normalizeDependsOn(testCase.dependsOn ?? testCase.dependencies),
            });
        }
        const orderedCases = this.orderByPriorityAndDependencies(plannedCases);
        const suiteScenario = this.scenarioText(req.requirement ?? req.scenario, 'Generated suite');
        const suitePlan = {
            suite: true,
            scenario: suiteScenario,
            steps: [],
            env: req.environment ?? 'default',
            applicationUrl: req.applicationUrl ?? process.env.BASE_URL,
            priority: this.readPriority(req, 0),
            testCases: orderedCases,
            executionOrder: orderedCases.map((testCase) => ({
                type: 'testCase',
                key: testCase.key,
                scenario: testCase.scenario,
                priority: testCase.priority,
                dependsOn: testCase.dependsOn,
                planPath: testCase.planPath,
            })),
        };
        if (Object.keys(req.locators ?? {}).length > 0) {
            suitePlan.locators = req.locators;
        }
        if (req.testData && typeof req.testData === 'object') {
            suitePlan.testData = req.testData;
        }
        return this.writePlan(suitePlan);
    }
    hasTestCaseCollection(req) {
        return ['testCases', 'testcases', 'tests', 'scenarios', 'flows']
            .some((key) => Array.isArray(req[key]) && req[key].length > 0);
    }
    extractTestCaseRequests(req) {
        const collection = req.testCases ?? req.testcases ?? req.tests ?? req.scenarios ?? req.flows ?? [];
        return (Array.isArray(collection) ? collection : [])
            .map((item, index) => this.normalizeTestCaseItem(item, req, index))
            .filter(Boolean);
    }
    normalizeTestCaseItem(item, parentReq, index) {
        const record = typeof item === 'string'
            ? { requirement: item }
            : item && typeof item === 'object'
                ? item
                : {};
        const requirement = this.scenarioText(record.requirement
            ?? record.scenario
            ?? record.name
            ?? record.testName
            ?? record.description
            ?? `Test case ${index + 1}`, `Test case ${index + 1}`);
        return {
            ...record,
            key: record.key ?? record.id ?? this.derivePreconditionKey(requirement) ?? `testCase${index + 1}`,
            requirement,
            applicationUrl: record.applicationUrl ?? parentReq.applicationUrl ?? process.env.BASE_URL,
            environment: record.environment ?? parentReq.environment ?? 'default',
            priority: this.readPriority(record, index + 1),
            testData: {
                ...(parentReq.credentials ?? {}),
                ...(parentReq.testData ?? {}),
                ...(record.credentials ?? {}),
                ...(record.testData ?? {}),
            },
            locators: this.normalizeLocatorAliases({
                ...(parentReq.locators ?? {}),
                ...(record.locators ?? {}),
            }),
            preconditions: record.preconditions ?? record.preConditions ?? parentReq.preconditions ?? parentReq.preConditions,
            preSteps: record.preSteps ?? record.presteps ?? parentReq.preSteps ?? parentReq.presteps,
            setup: record.setup ?? parentReq.setup,
            dependsOn: record.dependsOn ?? record.dependencies,
            dependencies: record.dependencies,
        };
    }
    scenarioText(value, fallback = 'UnnamedScenario') {
        const items = this.requirementItems(value);
        if (items.length)
            return items.join(' ');
        return fallback;
    }
    requirementItems(value) {
        if (Array.isArray(value)) {
            return value.flatMap((entry) => this.requirementItems(entry));
        }
        if (typeof value === 'string') {
            const trimmed = value.replace(/\s+/g, ' ').trim();
            return trimmed ? [trimmed] : [];
        }
        if (value && typeof value === 'object') {
            const record = value;
            return this.requirementItems(record.requirement
                ?? record.scenario
                ?? record.name
                ?? record.testName
                ?? record.description
                ?? record.objective
                ?? this.stableStringify(record));
        }
        if (value === undefined || value === null)
            return [];
        const text = String(value).replace(/\s+/g, ' ').trim();
        return text ? [text] : [];
    }
    filterRelevantRequirements(requirements, req) {
        if (requirements.length <= 1)
            return requirements;
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
        const locatorText = Object.entries(locators).map(([key, value]) => `${key} ${value}`).join(' ');
        const testData = req.testData && typeof req.testData === 'object' ? req.testData : {};
        const testDataText = Object.entries(testData).map(([key, value]) => `${key} ${String(value)}`).join(' ');
        const stepText = Array.isArray(req.steps)
            ? req.steps.map((step) => `${step?.action ?? ''} ${step?.target ?? ''} ${step?.value ?? ''} ${step?.expectedResult ?? ''}`).join(' ')
            : '';
        return this.locatorSearchText(`${req.applicationUrl ?? ''} ${req.environment ?? ''} ${locatorText}`, `${testDataText} ${stepText}`);
    }
    requirementMatchesPageContext(requirement, context) {
        if (/page\s+loads?|ui|visible|displayed|redirect|url|login\s+page|screen/i.test(requirement))
            return true;
        if (/logout|log\s*out|sign\s*out/i.test(requirement))
            return /logout|log\s*out|sign\s*out|login|user|session/.test(context);
        if (/login|log\s*in|sign\s*in/i.test(requirement))
            return /login|log\s*in|sign\s*in|user|email|password|submit/.test(context);
        const genericWords = new Set([
            'verify',
            'valid',
            'invalid',
            'success',
            'successfully',
            'without',
            'using',
            'should',
            'must',
            'page',
            'loads',
            'load',
            'issue',
            'issues',
            'user',
        ]);
        const specificWords = this.significantWords(requirement).filter((word) => !genericWords.has(word));
        if (!specificWords.length)
            return true;
        return specificWords.some((word) => context.includes(word));
    }
    orderByPriorityAndDependencies(items) {
        const remaining = [...items].sort((a, b) => a.priority - b.priority);
        const ordered = [];
        const emitted = new Set();
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
        let candidate = path_1.default.join(this.storageDir, `${shortBaseName}Plan.json`);
        if (!await (0, fs_extra_1.pathExists)(candidate))
            return candidate;
        let index = 2;
        while (await (0, fs_extra_1.pathExists)(candidate)) {
            const suffix = `_${index}`;
            const collisionBase = this.compactFileBase([shortBaseName], maxPlanBaseLength - suffix.length);
            candidate = path_1.default.join(this.storageDir, `${collisionBase}${suffix}Plan.json`);
            index += 1;
        }
        return candidate;
    }
    safeFileBase(value) {
        const words = String(value || 'UnnamedScenario')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
            .replace(/[^a-zA-Z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
        const stopWords = new Set([
            'automation',
            'verification',
            'verify',
            'user',
            'can',
            'to',
            'successfully',
            'using',
            'email',
            'password',
            'page',
            'loads',
            'load',
            'without',
            'ui',
            'issues',
            'issue',
            'redirects',
            'redirect',
            'back',
            'navigate',
            'site',
            'valid',
            'credentials',
            'shown',
            'after',
            'with',
            'the',
            'and',
            'then',
            'regression',
            'complete',
            'details',
        ]);
        const significant = words.filter((word) => !stopWords.has(word.toLowerCase()));
        const selected = this.hasWords(words, ['automation', 'demo', 'full'])
            ? ['Demo', 'Full']
            : significant[0]?.toLowerCase() === 'login' && significant[1]?.toLowerCase() === 'flow'
                ? significant.slice(0, 2)
                : significant.slice(0, 3);
        return this.compactFileBase(selected.length ? selected : words.slice(0, 2), 12) || 'Unnamed';
    }
    compactFileBase(words, maxLength) {
        const safeMaxLength = Math.max(1, maxLength);
        const normalizedWords = words
            .flatMap((word) => String(word).replace(/([a-z0-9])([A-Z])/g, '$1 $2').match(/[a-zA-Z0-9]+/g) ?? [])
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
        let output = '';
        for (const word of normalizedWords) {
            if (!output) {
                output = word.slice(0, safeMaxLength);
                continue;
            }
            if (output.length + word.length > safeMaxLength)
                continue;
            output += word;
        }
        return output || 'Unnamed'.slice(0, safeMaxLength);
    }
    hasWords(words, expectedWords) {
        const normalizedWords = new Set(words.map((word) => word.toLowerCase()));
        return expectedWords.every((word) => normalizedWords.has(word));
    }
    async resolvePreconditions(req) {
        const preconditionRequests = this.collectPreconditionRequests(req)
            .sort((a, b) => a.priority - b.priority);
        const planned = [];
        const seenKeys = new Set();
        for (const precondition of preconditionRequests) {
            const normalizedKey = this.normalizeKey(precondition.key);
            if (!normalizedKey || seenKeys.has(normalizedKey))
                continue;
            seenKeys.add(normalizedKey);
            const existingPlan = await this.findPlanForPrecondition(precondition);
            if (existingPlan) {
                const existingSetupSteps = await this.readPlanSteps(existingPlan);
                planned.push({
                    key: precondition.key,
                    requirement: precondition.requirement,
                    source: precondition.source,
                    status: 'existing',
                    planPath: existingPlan,
                    inline: precondition.inline,
                    priority: precondition.priority,
                    optional: precondition.optional,
                    dependsOn: precondition.dependsOn,
                    setupSteps: existingSetupSteps,
                });
                continue;
            }
            const steps = await this.createSteps(JSON.stringify(precondition.request, null, 2), precondition.request);
            const plan = {
                scenario: precondition.requirement,
                steps,
                env: precondition.request.environment ?? req.environment ?? 'default',
                applicationUrl: precondition.request.applicationUrl ?? req.applicationUrl ?? process.env.BASE_URL,
                precondition: true,
                preconditionKey: precondition.key,
                priority: precondition.priority,
                optional: precondition.optional,
                dependsOn: precondition.dependsOn,
            };
            if (precondition.request.locators && Object.keys(precondition.request.locators).length > 0) {
                plan.locators = precondition.request.locators;
            }
            if (precondition.request.testData && typeof precondition.request.testData === 'object') {
                plan.testData = precondition.request.testData;
            }
            const planPath = await this.writePlan(plan);
            planned.push({
                key: precondition.key,
                requirement: precondition.requirement,
                source: precondition.source,
                status: 'created',
                planPath,
                inline: precondition.inline,
                priority: precondition.priority,
                optional: precondition.optional,
                dependsOn: precondition.dependsOn,
                setupSteps: steps,
            });
        }
        return planned;
    }
    inlinePreconditionSteps(preconditions, mainSteps) {
        const existingText = this.stepsSearchText(mainSteps);
        return preconditions
            .filter((precondition) => precondition.inline)
            .sort((a, b) => a.priority - b.priority)
            .flatMap((precondition) => (precondition.setupSteps ?? [])
            .filter((step) => !this.isDuplicateSetupStep(step, existingText))
            .map((step) => ({
            ...step,
            preconditionKey: precondition.key,
            source: 'inlinePrecondition',
            optional: step.optional ?? precondition.optional,
        })));
    }
    isDuplicateSetupStep(step, existingText) {
        const action = this.normalizeKey(String(step?.action ?? ''));
        const target = this.normalizeKey(String(step?.target ?? ''));
        if (!action || !target)
            return false;
        return existingText.includes(`${action}:${target}`);
    }
    stepsSearchText(steps) {
        return steps.map((step) => `${this.normalizeKey(String(step?.action ?? ''))}:${this.normalizeKey(String(step?.target ?? ''))}`).join(' ');
    }
    async readPlanSteps(planPath) {
        try {
            const plan = JSON.parse(await (0, fs_extra_1.readFile)(planPath, 'utf-8'));
            return Array.isArray(plan.steps) ? plan.steps : [];
        }
        catch {
            return [];
        }
    }
    collectPreconditionRequests(req) {
        const requests = [
            ...this.normalizePreconditionCollection(req.preconditions, req, 'preconditions'),
            ...this.normalizePreconditionCollection(req.preConditions, req, 'preConditions'),
            ...this.normalizePreconditionCollection(req.preSteps, req, 'preSteps'),
            ...this.normalizePreconditionCollection(req.presteps, req, 'presteps'),
            ...this.normalizePreconditionCollection(req.dependsOn, req, 'dependsOn'),
            ...this.normalizePreconditionCollection(req.dependencies, req, 'dependencies'),
            ...this.normalizePreconditionCollection(req.setup, req, 'setup'),
        ];
        return requests;
    }
    normalizePreconditionCollection(value, parentReq, source) {
        if (value === undefined || value === null || value === false)
            return [];
        const items = Array.isArray(value) ? value : [value];
        return items.flatMap((item) => this.normalizePreconditionItem(item, parentReq, source));
    }
    normalizePreconditionItem(item, parentReq, source) {
        if (typeof item === 'string') {
            const requirement = item.trim();
            if (!requirement)
                return [];
            return [this.createPreconditionRequest(requirement, {}, parentReq, source)];
        }
        if (!item || typeof item !== 'object')
            return [];
        const record = item;
        const requirement = String(record.requirement
            ?? record.scenario
            ?? record.name
            ?? record.objective
            ?? record.description
            ?? record.testName
            ?? '').trim();
        if (!requirement)
            return [];
        return [this.createPreconditionRequest(requirement, record, parentReq, source)];
    }
    createPreconditionRequest(requirement, item, parentReq, source) {
        const request = {
            ...item,
            applicationUrl: item.applicationUrl ?? parentReq.applicationUrl ?? process.env.BASE_URL,
            environment: item.environment ?? parentReq.environment ?? 'default',
            requirement,
            testData: this.mergePreconditionTestData(parentReq.testData, item.testData),
            locators: this.normalizeLocatorAliases({
                ...(parentReq.locators ?? {}),
                ...(item.locators ?? {}),
            }),
        };
        return {
            key: String(item.key ?? item.type ?? this.derivePreconditionKey(requirement)),
            requirement,
            source,
            inline: item.inline !== false,
            priority: this.readPriority(item, this.defaultPreconditionPriority(requirement)),
            optional: Boolean(item.optional ?? item.continueOnFailure),
            dependsOn: this.normalizeDependsOn(item.dependsOn ?? item.dependencies),
            request,
        };
    }
    mergePreconditionTestData(parentTestData, preconditionTestData) {
        const parent = parentTestData && typeof parentTestData === 'object'
            ? parentTestData
            : {};
        const own = preconditionTestData && typeof preconditionTestData === 'object'
            ? preconditionTestData
            : {};
        return { ...parent, ...own };
    }
    mergeCredentialsIntoTestData(req) {
        const credentials = req.credentials && typeof req.credentials === 'object'
            ? req.credentials
            : {};
        const testData = req.testData && typeof req.testData === 'object'
            ? req.testData
            : {};
        return { ...credentials, ...testData };
    }
    defaultPreconditionPriority(requirement) {
        return 50;
    }
    derivePreconditionKey(requirement) {
        const words = this.significantWords(requirement).slice(0, 4);
        if (!words.length)
            return 'precondition';
        return words
            .map((word, index) => index === 0
            ? word
            : word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }
    async findPlanForPrecondition(precondition) {
        const plans = await this.readStoredPlans();
        return plans.find(({ plan }) => this.planMatchesPrecondition(plan, precondition))?.file;
    }
    planMatchesPrecondition(plan, precondition) {
        if (!this.applicationUrlsMatch(this.planApplicationUrl(plan), precondition.request.applicationUrl)) {
            return false;
        }
        const scenario = this.scenarioText(plan.scenario ?? plan.testName, '');
        const expectedWords = this.significantWords(precondition.requirement);
        const scenarioText = this.locatorSearchText(scenario, '');
        const matchedWords = expectedWords.filter((word) => scenarioText.includes(word));
        return expectedWords.length > 0 && matchedWords.length >= Math.min(2, expectedWords.length);
    }
    async findMatchingRequestPlan(req) {
        const fingerprint = this.requestFingerprint(req);
        const plans = await this.readStoredPlans();
        return plans.find(({ file, plan }) => (!plan.suite
            && !plan.precondition
            && !plan.testCase
            && this.requestFingerprint(plan) === fingerprint
            && this.isShortPlanFileName(file)))?.file;
    }
    requestFingerprint(value) {
        return this.stableStringify({
            scenario: this.scenarioText(value.requirement ?? value.scenario ?? value.testName ?? ''),
            env: value.env ?? value.environment ?? 'default',
            applicationUrl: this.planApplicationUrl(value),
            locators: this.normalizeLocatorAliases(value.locators),
            testData: value.testData ?? {},
            dependsOn: this.normalizeDependsOn(value.dependsOn ?? value.dependencies),
        });
    }
    async findMatchingPlan(plan) {
        const fingerprint = this.planFingerprint(plan);
        const expectedPrefix = this.compactFileBase([this.safeFileBase(this.scenarioText(plan.scenario ?? plan.testName, ''))], 50);
        const plans = await this.readStoredPlans();
        return plans.find(({ file, plan: existingPlan }) => (this.planFingerprint(existingPlan) === fingerprint
            && this.isShortPlanFileName(file)
            && this.isExpectedPlanFileName(file, expectedPrefix)))?.file;
    }
    isShortPlanFileName(file) {
        return path_1.default.basename(file).length <= 60;
    }
    isExpectedPlanFileName(file, expectedPrefix) {
        const escapedPrefix = expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^${escapedPrefix}(?:_\\d+)?Plan\\.json$`).test(path_1.default.basename(file));
    }
    async readStoredPlans() {
        if (!await (0, fs_extra_1.pathExists)(this.storageDir))
            return [];
        const entries = await (0, fs_extra_1.readdir)(this.storageDir);
        const plans = [];
        for (const entry of entries.filter((name) => name.endsWith('.json'))) {
            const file = path_1.default.join(this.storageDir, entry);
            try {
                const plan = JSON.parse(await (0, fs_extra_1.readFile)(file, 'utf-8'));
                if (plan && typeof plan === 'object')
                    plans.push({ file, plan });
            }
            catch {
                this.logger.warn(`PlanningAgent: ignoring unreadable plan ${file}`);
            }
        }
        return plans;
    }
    planFingerprint(plan) {
        return this.stableStringify({
            scenario: this.scenarioText(plan.scenario ?? plan.testName ?? ''),
            env: plan.env ?? plan.environment ?? 'default',
            applicationUrl: this.planApplicationUrl(plan),
            steps: Array.isArray(plan.steps) ? plan.steps : [],
            locators: plan.locators ?? {},
            testData: plan.testData ?? {},
            precondition: Boolean(plan.precondition),
            preconditionKey: plan.preconditionKey ?? '',
            suite: Boolean(plan.suite),
            testCase: Boolean(plan.testCase),
            priority: plan.priority ?? 100,
            dependsOn: plan.dependsOn ?? [],
            executionOrder: plan.executionOrder ?? [],
        });
    }
    planApplicationUrl(plan) {
        return String(plan.applicationUrl ?? this.inferApplicationUrlFromSteps(plan.steps) ?? '').trim();
    }
    applicationUrlsMatch(left, right) {
        const leftUrl = String(left ?? '').trim();
        const rightUrl = String(right ?? '').trim();
        if (!leftUrl || !rightUrl)
            return true;
        try {
            return new URL(leftUrl).origin === new URL(rightUrl).origin;
        }
        catch {
            return leftUrl === rightUrl;
        }
    }
    inferApplicationUrlFromSteps(steps) {
        if (!Array.isArray(steps))
            return undefined;
        for (const step of steps) {
            if (String(step?.action ?? '').toLowerCase() !== 'navigate')
                continue;
            const url = [step?.value, step?.target]
                .map((value) => String(value ?? '').trim())
                .find((value) => /^https?:\/\//i.test(value));
            if (url)
                return url;
        }
        return undefined;
    }
    stableStringify(value) {
        if (Array.isArray(value)) {
            return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
        }
        if (value && typeof value === 'object') {
            const record = value;
            return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
        }
        return JSON.stringify(value);
    }
    parseRequirement(raw, requestFile) {
        try {
            return JSON.parse(raw);
        }
        catch {
            const fileName = path_1.default.basename(requestFile, path_1.default.extname(requestFile));
            this.logger.warn(`Requirement file is not JSON; treating ${requestFile} as plain-text requirement`);
            return {
                applicationUrl: process.env.BASE_URL,
                environment: process.env.ENVIRONMENT ?? 'default',
                requirement: raw.trim() || fileName.replace(/[-_]+/g, ' '),
                testData: {},
            };
        }
    }
    async createSteps(rawRequest, req) {
        if (Array.isArray(req.steps) && req.steps.length) {
            this.logger.info(`PlanningAgent: using ${req.steps.length} explicit requirement step(s) from request`);
            return this.normalizeSteps(req.steps);
        }
        try {
            if (!Config_1.Config.get().aiEnabled) {
                throw new FrameworkError_1.FrameworkError('AI features are disabled (AI_ENABLE=false)', undefined, 'PLAN_AI_DISABLED');
            }
            const template = await (0, fs_extra_1.readFile)(this.promptPath, 'utf-8');
            const prompt = template.replace('{{REQUEST_JSON}}', rawRequest);
            this.logger.info(`PlanningAgent: using prompt template ${this.promptPath}`);
            const output = await LLMProvider_1.LLMProviderFactory.getProvider().generate(prompt);
            const steps = this.parseSteps(output);
            if (steps.length) {
                this.logger.info(`PlanningAgent: accepted prompt output with ${steps.length} steps`);
                return steps;
            }
            this.logger.warn('PlanningAgent: prompt output was empty or invalid JSON; using local fallback plan');
        }
        catch (err) {
            this.logger.warn('PlanningAgent: prompt execution failed; using local fallback plan', { error: err });
        }
        this.logger.info('PlanningAgent: local fallback preserves provided locators and uses semantic names when locators are missing');
        return this.createFallbackSteps(req);
    }
    parseSteps(output) {
        const cleaned = this.cleanJsonOutput(output);
        if (!cleaned)
            return [];
        try {
            const parsed = JSON.parse(cleaned);
            const steps = Array.isArray(parsed) ? parsed : parsed.steps;
            if (Array.isArray(steps))
                return this.normalizeSteps(steps);
        }
        catch {
            return [];
        }
        return [];
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
        const locators = req.locators ?? {};
        const requirement = this.scenarioText(req.requirement ?? req.scenario, '').toLowerCase();
        const steps = [
            {
                step: 1,
                action: 'navigate',
                target: req.applicationUrl ?? process.env.BASE_URL,
            },
        ];
        for (const [key, value] of Object.entries(req.testData ?? {})) {
            if (value === undefined || value === null)
                continue;
            steps.push({
                step: steps.length + 1,
                action: this.inferInputAction(key, requirement),
                target: this.pickLocatorTarget(locators, [key], key),
                value,
            });
        }
        const submitTarget = this.pickLocatorTarget(locators, ['submitButton', 'saveButton', 'loginButton', 'addButton', 'createButton'], '');
        if (submitTarget) {
            steps.push({
                step: steps.length + 1,
                action: 'click',
                target: submitTarget,
            });
        }
        const expectedTarget = this.pickLocatorTarget(locators, ['successMessage', 'expectedElement', 'dashboard', 'results'], 'page');
        steps.push({
            step: steps.length + 1,
            action: req.expectedText ? 'assertText' : 'assertVisible',
            target: expectedTarget,
            value: req.expectedText ?? 'visible',
        });
        return steps;
    }
    inferInputAction(key, requirement) {
        if (/country|state|type|category|dropdown|select/i.test(key))
            return 'select';
        if (/search|query|keyword/i.test(key) || requirement.includes('search'))
            return 'fill';
        return 'fill';
    }
    locatorSearchText(key, selector) {
        return `${key} ${selector}`
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .toLowerCase();
    }
    significantWords(value) {
        const stopWords = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'item', 'items', 'product', 'products']);
        return (value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').match(/[a-zA-Z0-9]+/g) ?? [])
            .map((word) => word.toLowerCase())
            .filter((word) => word.length > 1 && !stopWords.has(word));
    }
    normalizeLocatorAliases(locatorsInput) {
        if (!locatorsInput || typeof locatorsInput !== 'object')
            return {};
        const locators = Object.fromEntries(Object.entries(locatorsInput)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value).trim()])
            .filter(([, value]) => value.length > 0));
        return locators;
    }
    findLocatorValue(locators, candidates, pattern) {
        const entries = Object.entries(locators);
        for (const candidate of candidates) {
            const normalizedCandidate = this.normalizeKey(candidate);
            const match = entries.find(([key]) => this.normalizeKey(key) === normalizedCandidate);
            if (match)
                return match[1];
        }
        if (pattern) {
            const match = entries.find(([key]) => pattern.test(key));
            if (match)
                return match[1];
        }
        return undefined;
    }
    pickLocatorTarget(locators, candidates, fallback) {
        for (const candidate of candidates) {
            if (locators[candidate])
                return candidate;
        }
        const normalizedCandidates = new Set(candidates.map((candidate) => this.normalizeKey(candidate)));
        const match = Object.keys(locators).find((key) => normalizedCandidates.has(this.normalizeKey(key)));
        return match ?? fallback;
    }
    normalizeKey(value) {
        return value.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    readPriority(value, fallback) {
        const raw = value.priority ?? value.order ?? value.sequence ?? value.rank;
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    normalizeDependsOn(value) {
        if (value === undefined || value === null || value === false)
            return [];
        const values = Array.isArray(value) ? value : [value];
        return values
            .map((entry) => typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object'
                ? String(entry.key ?? entry.name ?? entry.requirement ?? '')
                : '')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }
    reindexSteps(steps) {
        return steps.map((step, index) => ({
            ...step,
            step: index + 1,
        }));
    }
    normalizeSteps(steps) {
        return steps.map((step, index) => ({
            ...step,
            step: step.step ?? index + 1,
            target: step.target ?? '',
            value: step.value ?? '',
        }));
    }
}
exports.PlanningAgent = PlanningAgent;
//# sourceMappingURL=PlanningAgent.js.map