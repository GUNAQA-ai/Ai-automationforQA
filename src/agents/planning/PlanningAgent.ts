import { readFile, writeFile, ensureDir, pathExists, readdir } from 'fs-extra';
import path from 'path';
import { chromium, Browser } from '@playwright/test';
import Logger from '../../utils/logger';
import { LLMProviderFactory } from '../../framework/LLMProvider';
import { FrameworkError } from '../../framework/FrameworkError';
import { Config } from '../../framework/Config';
import { FrameworkApiExtractor } from '../../utils/FrameworkApiExtractor';

interface PlannedPrecondition {
  key: string;
  requirement: string;
  source: string;
  status: 'existing' | 'created';
  planPath: string;
  inline: boolean;
  priority: number;
  optional: boolean;
  dependsOn: string[];
  setupSteps?: any[];
}

interface PreconditionRequest {
  key: string;
  requirement: string;
  source: string;
  inline: boolean;
  priority: number;
  optional: boolean;
  dependsOn: string[];
  request: Record<string, any>;
}

export class PlanningAgent {
  private readonly logger = Logger.getInstance();
  private readonly storageDir = path.resolve('storage', 'plans');
  private readonly promptPath = path.resolve('prompts', 'planning.txt');

  async run(requestFile: string): Promise<string> {
    try {
      const raw = await readFile(requestFile, 'utf-8');
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
    } catch (err) {
      this.logger.error('PlanningAgent failed', { error: err });
      throw new FrameworkError('Planning failed', err as Error);
    }
  }

  private normalizeRequestShape(req: any): any {
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

  private async buildPlan(req: any, overrides: Record<string, any> = {}): Promise<Record<string, any>> {
    const { steps: rawSteps, locators: newLocators } = await this.createSteps(JSON.stringify(req, null, 2), req);
    const preconditions = await this.resolvePreconditions(req);
    const setupSteps = this.inlinePreconditionSteps(preconditions, rawSteps);
    const steps = this.reindexSteps([...setupSteps, ...rawSteps]);
    const scenario = this.scenarioText(req.requirement ?? req.scenario ?? req.testName, 'UnnamedScenario');
    const requirements = this.requirementItems(req.requirements ?? req.requirement ?? req.scenario ?? req.testName);
    const plan: Record<string, any> = {
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
    const mergedLocators = { ...(req.locators ?? {}), ...(newLocators ?? {}) };
    if (Object.keys(mergedLocators).length > 0) {
      this.logger.info(`PlanningAgent: validating ${Object.keys(mergedLocators).length} locators against DOM`);
      plan.locators = await this.validateLocatorsAgainstDom(plan.applicationUrl, mergedLocators);
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

  private async writePlan(plan: Record<string, any>): Promise<string> {
    await ensureDir(this.storageDir);
    const existingPlan = await this.findMatchingPlan(plan);
    if (existingPlan) {
      this.logger.info(`PlanningAgent: reusing existing plan ${existingPlan}`);
      return existingPlan;
    }

    const planPath = await this.nextPlanPath(this.safeFileBase(plan.scenario));
    await writeFile(planPath, JSON.stringify(plan, null, 2));
    this.logger.info(`Plan written to ${planPath}`);
    return planPath;
  }

  private async writeSuitePlan(req: any): Promise<string> {
    const testCases = this.extractTestCaseRequests(req)
      .sort((a, b) => this.readPriority(a, 100) - this.readPriority(b, 100));
    const plannedCases: Array<{ key: string; scenario: string; priority: number; planPath: string; dependsOn: string[] }> = [];

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
    const suiteScenario = this.scenarioText(req.testName ?? req.scenario ?? 'TestSuite', 'Generated suite') + ' Master Suite';
    const suitePlan: Record<string, any> = {
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

  private hasTestCaseCollection(req: any): boolean {
    const keys = ['testCases', 'testcases', 'tests', 'scenarios', 'flows'];
    for (const key of keys) {
      if (Array.isArray(req[key]) && req[key].length > 0) {
        if (typeof req[key][0] === 'object') return true;
      }
    }
    return false;
  }

  private extractTestCaseRequests(req: any): any[] {
    const collection = req.testCases ?? req.testcases ?? req.tests ?? req.scenarios ?? req.flows ?? (Array.isArray(req.requirements) ? req.requirements : (Array.isArray(req.requirement) ? req.requirement : []));
    const items = (Array.isArray(collection) ? collection : [])
      .map((item, index) => this.normalizeTestCaseItem(item, req, index))
      .filter(Boolean);

    for (let i = 1; i < items.length; i++) {
      if (items[i - 1].requirement.toLowerCase().includes('precondition')) {
        items[i - 1].precondition = true;
        if (!items[i].dependsOn) items[i].dependsOn = [];
        if (!items[i].dependsOn.includes(items[i - 1].key)) {
          items[i].dependsOn.push(items[i - 1].key);
        }
      }
    }

    // Ensure the first item is marked as precondition if it has the keyword
    if (items.length > 0 && items[0].requirement.toLowerCase().includes('precondition')) {
      items[0].precondition = true;
    }

    return items;
  }

  private normalizeTestCaseItem(item: unknown, parentReq: any, index: number): any {
    const record = typeof item === 'string'
      ? { requirement: item }
      : item && typeof item === 'object'
        ? item as Record<string, any>
        : {};
    const requirement = this.scenarioText(
      record.requirement
      ?? record.scenario
      ?? record.name
      ?? record.testName
      ?? record.description
      ?? `Test case ${index + 1}`,
      `Test case ${index + 1}`
    );

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

  private scenarioText(value: unknown, fallback = 'UnnamedScenario'): string {
    const items = this.requirementItems(value);
    if (items.length) return items.join(' ');
    return fallback;
  }

  private requirementItems(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => this.requirementItems(entry));
    }

    if (typeof value === 'string') {
      const trimmed = value.replace(/\s+/g, ' ').trim();
      return trimmed ? [trimmed] : [];
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return this.requirementItems(
        record.requirement
        ?? record.scenario
        ?? record.name
        ?? record.testName
        ?? record.description
        ?? record.objective
        ?? this.stableStringify(record)
      );
    }

    if (value === undefined || value === null) return [];

    const text = String(value).replace(/\s+/g, ' ').trim();
    return text ? [text] : [];
  }

  private filterRelevantRequirements(requirements: string[], req: any): string[] {
    if (requirements.length <= 1) return requirements;

    const context = this.requestUiContext(req);
    const filtered = requirements.filter((requirement) => this.requirementMatchesPageContext(requirement, context));
    if (filtered.length > 0 && filtered.length < requirements.length) {
      this.logger.info(`PlanningAgent: removed ${requirements.length - filtered.length} requirement(s) that did not match the available page context`);
      return filtered;
    }

    return requirements;
  }

  private requestUiContext(req: any): string {
    const locators = this.normalizeLocatorAliases(req.locators);
    const locatorText = Object.entries(locators).map(([key, value]) => `${key} ${value}`).join(' ');
    const testData = req.testData && typeof req.testData === 'object' ? req.testData as Record<string, unknown> : {};
    const testDataText = Object.entries(testData).map(([key, value]) => `${key} ${String(value)}`).join(' ');
    const stepText = Array.isArray(req.steps)
      ? req.steps.map((step: any) => `${step?.action ?? ''} ${step?.target ?? ''} ${step?.value ?? ''} ${step?.expectedResult ?? ''}`).join(' ')
      : '';

    return this.locatorSearchText(`${req.applicationUrl ?? ''} ${req.environment ?? ''} ${locatorText}`, `${testDataText} ${stepText}`);
  }

  private requirementMatchesPageContext(requirement: string, context: string): boolean {
    if (/page\s+loads?|ui|visible|displayed|redirect|url|login\s+page|screen/i.test(requirement)) return true;
    if (/logout|log\s*out|sign\s*out/i.test(requirement)) return /logout|log\s*out|sign\s*out|login|user|session/.test(context);
    if (/login|log\s*in|sign\s*in/i.test(requirement)) return /login|log\s*in|sign\s*in|user|email|password|submit/.test(context);

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
    if (!specificWords.length) return true;

    return specificWords.some((word) => context.includes(word));
  }

  private orderByPriorityAndDependencies<T extends { key: string; priority: number; dependsOn: string[] }>(items: T[]): T[] {
    const remaining = [...items].sort((a, b) => a.priority - b.priority);
    const ordered: T[] = [];
    const emitted = new Set<string>();

    while (remaining.length) {
      const nextIndex = remaining.findIndex((item) => item.dependsOn.every((dependency) => emitted.has(this.normalizeKey(dependency))));
      const index = nextIndex >= 0 ? nextIndex : 0;
      const [next] = remaining.splice(index, 1);
      ordered.push(next);
      emitted.add(this.normalizeKey(next.key));
    }

    return ordered;
  }

  private async nextPlanPath(baseName: string): Promise<string> {
    const maxPlanBaseLength = 50;
    const shortBaseName = this.compactFileBase([baseName], maxPlanBaseLength);
    return path.join(this.storageDir, `${shortBaseName}Plan.json`);
  }

  private safeFileBase(value: string): string {
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

  private compactFileBase(words: string[], maxLength: number): string {
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
      if (output.length + word.length > safeMaxLength) continue;
      output += word;
    }

    return output || 'Unnamed'.slice(0, safeMaxLength);
  }

  private hasWords(words: string[], expectedWords: string[]): boolean {
    const normalizedWords = new Set(words.map((word) => word.toLowerCase()));
    return expectedWords.every((word) => normalizedWords.has(word));
  }

  private async resolvePreconditions(req: any): Promise<PlannedPrecondition[]> {
    const preconditionRequests = this.collectPreconditionRequests(req)
      .sort((a, b) => a.priority - b.priority);
    const planned: PlannedPrecondition[] = [];
    const seenKeys = new Set<string>();

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

      const { steps, locators: preLocators } = await this.createSteps(JSON.stringify(precondition.request, null, 2), precondition.request);
      const plan: Record<string, any> = {
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

      const mergedLocators = { ...(precondition.request.locators ?? {}), ...(preLocators ?? {}) };
      if (Object.keys(mergedLocators).length > 0) {
        this.logger.info(`PlanningAgent: validating ${Object.keys(mergedLocators).length} locators against DOM for precondition ${precondition.key}`);
        plan.locators = await this.validateLocatorsAgainstDom(plan.applicationUrl, mergedLocators);
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

  private inlinePreconditionSteps(preconditions: PlannedPrecondition[], mainSteps: any[]): any[] {
    const existingText = this.stepsSearchText(mainSteps);
    return preconditions
      .filter((precondition) => precondition.inline !== false)
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

  private isDuplicateSetupStep(step: any, existingText: string): boolean {
    const action = this.normalizeKey(String(step?.action ?? ''));
    const target = this.normalizeKey(String(step?.target ?? ''));
    if (!action || !target) return false;
    return existingText.includes(`${action}:${target}`);
  }

  private stepsSearchText(steps: any[]): string {
    return steps.map((step) => `${this.normalizeKey(String(step?.action ?? ''))}:${this.normalizeKey(String(step?.target ?? ''))}`).join(' ');
  }

  private async readPlanSteps(planPath: string): Promise<any[]> {
    try {
      const plan = JSON.parse(await readFile(planPath, 'utf-8'));
      return Array.isArray(plan.steps) ? plan.steps : [];
    } catch {
      return [];
    }
  }

  private collectPreconditionRequests(req: any): PreconditionRequest[] {
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

  private normalizePreconditionCollection(value: unknown, parentReq: any, source: string): PreconditionRequest[] {
    if (value === undefined || value === null || value === false) return [];
    const items = Array.isArray(value) ? value : [value];
    return items.flatMap((item) => this.normalizePreconditionItem(item, parentReq, source));
  }

  private normalizePreconditionItem(item: unknown, parentReq: any, source: string): PreconditionRequest[] {
    if (typeof item === 'string') {
      const requirement = item.trim();
      if (!requirement) return [];
      return [this.createPreconditionRequest(requirement, {}, parentReq, source)];
    }

    if (!item || typeof item !== 'object') return [];

    const record = item as Record<string, any>;
    const requirement = String(
      record.requirement
      ?? record.scenario
      ?? record.name
      ?? record.objective
      ?? record.description
      ?? record.testName
      ?? ''
    ).trim();
    if (!requirement) return [];

    return [this.createPreconditionRequest(requirement, record, parentReq, source)];
  }

  private createPreconditionRequest(requirement: string, item: Record<string, any>, parentReq: any, source: string): PreconditionRequest {
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

  private mergePreconditionTestData(parentTestData: unknown, preconditionTestData: unknown): Record<string, unknown> {
    const parent = parentTestData && typeof parentTestData === 'object'
      ? parentTestData as Record<string, unknown>
      : {};
    const own = preconditionTestData && typeof preconditionTestData === 'object'
      ? preconditionTestData as Record<string, unknown>
      : {};

    return { ...parent, ...own };
  }

  private mergeCredentialsIntoTestData(req: any): Record<string, unknown> {
    const credentials = req.credentials && typeof req.credentials === 'object'
      ? req.credentials as Record<string, unknown>
      : {};
    const testData = req.testData && typeof req.testData === 'object'
      ? req.testData as Record<string, unknown>
      : {};

    return { ...credentials, ...testData };
  }

  private defaultPreconditionPriority(requirement: string): number {
    return 50;
  }

  private derivePreconditionKey(requirement: string): string {
    const words = this.significantWords(requirement).slice(0, 4);
    if (!words.length) return 'precondition';
    return words
      .map((word, index) => index === 0
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1))
      .join('');
  }

  private async findPlanForPrecondition(precondition: PreconditionRequest): Promise<string | undefined> {
    const plans = await this.readStoredPlans();
    return plans.find(({ plan }) => this.planMatchesPrecondition(plan, precondition))?.file;
  }

  private planMatchesPrecondition(plan: Record<string, any>, precondition: PreconditionRequest): boolean {
    if (!this.applicationUrlsMatch(this.planApplicationUrl(plan), precondition.request.applicationUrl)) {
      return false;
    }

    const scenario = this.scenarioText(plan.scenario ?? plan.testName, '');
    const expectedWords = this.significantWords(precondition.requirement);
    const scenarioText = this.locatorSearchText(scenario, '');
    const matchedWords = expectedWords.filter((word) => scenarioText.includes(word));
    return expectedWords.length > 0 && matchedWords.length >= Math.min(2, expectedWords.length);
  }

  private async findMatchingRequestPlan(req: Record<string, any>): Promise<string | undefined> {
    const fingerprint = this.requestFingerprint(req);
    const plans = await this.readStoredPlans();
    return plans.find(({ file, plan }) => (
      !plan.suite
      && !plan.precondition
      && !plan.testCase
      && this.requestFingerprint(plan) === fingerprint
      && this.isShortPlanFileName(file)
    ))?.file;
  }

  private requestFingerprint(value: Record<string, any>): string {
    return this.stableStringify({
      scenario: this.scenarioText(value.requirement ?? value.scenario ?? value.testName ?? ''),
      env: value.env ?? value.environment ?? 'default',
      applicationUrl: this.planApplicationUrl(value),
      locators: this.normalizeLocatorAliases(value.locators),
      testData: value.testData ?? {},
      dependsOn: this.normalizeDependsOn(value.dependsOn ?? value.dependencies),
    });
  }

  private async findMatchingPlan(plan: Record<string, any>): Promise<string | undefined> {
    const fingerprint = this.planFingerprint(plan);
    const expectedPrefix = this.compactFileBase([this.safeFileBase(this.scenarioText(plan.scenario ?? plan.testName, ''))], 50);
    const plans = await this.readStoredPlans();
    return plans.find(({ file, plan: existingPlan }) => (
      this.planFingerprint(existingPlan) === fingerprint
      && this.isShortPlanFileName(file)
      && this.isExpectedPlanFileName(file, expectedPrefix)
    ))?.file;
  }

  private isShortPlanFileName(file: string): boolean {
    return path.basename(file).length <= 16;
  }

  private isExpectedPlanFileName(file: string, expectedPrefix: string): boolean {
    const escapedPrefix = expectedPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escapedPrefix}(?:_\\d+)?Plan\\.json$`).test(path.basename(file));
  }

  private async readStoredPlans(): Promise<Array<{ file: string; plan: Record<string, any> }>> {
    if (!await pathExists(this.storageDir)) return [];

    const entries = await readdir(this.storageDir);
    const plans: Array<{ file: string; plan: Record<string, any> }> = [];
    for (const entry of entries.filter((name) => name.endsWith('.json'))) {
      const file = path.join(this.storageDir, entry);
      try {
        const plan = JSON.parse(await readFile(file, 'utf-8'));
        if (plan && typeof plan === 'object') plans.push({ file, plan });
      } catch {
        this.logger.warn(`PlanningAgent: ignoring unreadable plan ${file}`);
      }
    }

    return plans;
  }

  private planFingerprint(plan: Record<string, any>): string {
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

  private planApplicationUrl(plan: Record<string, any>): string {
    return String(plan.applicationUrl ?? this.inferApplicationUrlFromSteps(plan.steps) ?? '').trim();
  }

  private applicationUrlsMatch(left: unknown, right: unknown): boolean {
    const leftUrl = String(left ?? '').trim();
    const rightUrl = String(right ?? '').trim();
    if (!leftUrl || !rightUrl) return true;

    try {
      return new URL(leftUrl).origin === new URL(rightUrl).origin;
    } catch {
      return leftUrl === rightUrl;
    }
  }

  private inferApplicationUrlFromSteps(steps: unknown): string | undefined {
    if (!Array.isArray(steps)) return undefined;

    for (const step of steps) {
      if (String(step?.action ?? '').toLowerCase() !== 'navigate') continue;
      const url = [step?.value, step?.target]
        .map((value) => String(value ?? '').trim())
        .find((value) => /^https?:\/\//i.test(value));
      if (url) return url;
    }

    return undefined;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
    }

    return JSON.stringify(value);
  }

  private parseRequirement(raw: string, requestFile: string): any {
    try {
      return JSON.parse(raw);
    } catch {
      const fileName = path.basename(requestFile, path.extname(requestFile));
      this.logger.warn(`Requirement file is not JSON; treating ${requestFile} as plain-text requirement`);
      return {
        applicationUrl: process.env.BASE_URL,
        environment: process.env.ENVIRONMENT ?? 'default',
        requirement: raw.trim() || fileName.replace(/[-_]+/g, ' '),
        testData: {},
      };
    }
  }

  private async createSteps(rawRequest: string, req: any): Promise<{ steps: any[]; locators?: Record<string, string> }> {
    if (Array.isArray(req.steps) && req.steps.length) {
      this.logger.info(`PlanningAgent: using ${req.steps.length} explicit requirement step(s) from request`);
      return { steps: this.normalizeSteps(req.steps), locators: req.locators };
    }

    let domLocators: Record<string, string> = {};
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
        throw new FrameworkError('AI features are disabled (AI_ENABLE=false)', undefined, 'PLAN_AI_DISABLED');
      }

      let domContext = '';
      if (!req.locators || Object.keys(req.locators).length === 0) {
        const appUrl = req.applicationUrl || process.env.BASE_URL;
        if (appUrl) {
          this.logger.info(`PlanningAgent: No locators provided. Fetching DOM context for ${appUrl}`);
          domContext = await this.fetchDomContext(appUrl);
        }
      }

      const template = await readFile(this.promptPath, 'utf-8');
      const frameworkApiDoc = await FrameworkApiExtractor.extractApiDocs();
      const prompt = template.replace('{{REQUEST_JSON}}', rawRequest).replace('{{DOM_CONTEXT}}', domContext).replace('{{FRAMEWORK_API}}', frameworkApiDoc);
      this.logger.info(`PlanningAgent: using prompt template ${this.promptPath}`);
      const output = await LLMProviderFactory.getProvider().generate(prompt);
      const parsed = this.parseStepsOutput(output);

      if (parsed.steps.length) {
        this.logger.info(`PlanningAgent: accepted prompt output with ${parsed.steps.length} steps`);
        return parsed;
      }

      this.logger.warn('PlanningAgent: prompt output was empty or invalid JSON; using local fallback plan');
    } catch (err) {
      this.logger.warn('PlanningAgent: prompt execution failed; using local fallback plan', { error: err });
    }

    this.logger.info('PlanningAgent: local fallback preserves provided locators and uses semantic names when locators are missing');
    return { steps: this.createFallbackSteps(req) };
  }

  private parseStepsOutput(output: string): { steps: any[]; locators?: Record<string, string> } {
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

  private async fetchDomContext(url: string): Promise<string> {
    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Remove scripts, styles, svgs to save tokens
      await page.evaluate(`
        document.querySelectorAll('script, style, svg, noscript').forEach(el => el.remove());
      `);
      const html = await page.content();
      return html;
    } catch (err) {
      this.logger.warn(`PlanningAgent: failed to fetch DOM from ${url}`, { error: err });
      return '';
    } finally {
      if (browser) await browser.close();
    }
  }

  private async validateLocatorsAgainstDom(url: string, locators: Record<string, string>): Promise<Record<string, string>> {
    if (!url) return locators;
    let browser: Browser | undefined;
    const validatedLocators: Record<string, string> = {};
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

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
      return locators; // If we can't load the page, assume they are good
    } finally {
      if (browser) await browser.close();
    }
  }

  private async fetchLocalHeuristicLocators(url: string, req: any): Promise<Record<string, string>> {
    let browser: Browser | undefined;
    const discoveredLocators: Record<string, string> = {};
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      const elements: any = await page.evaluate(`
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

      const keywordsToFind = new Set<string>();
      if (req.testData) {
        Object.keys(req.testData).forEach(k => keywordsToFind.add(k.toLowerCase()));
      }
      const reqText = this.scenarioText(req.requirement ?? req.scenario, '').toLowerCase();

      const words = reqText.split(/\s+/);
      for (const word of words) {
        const cleanWord = word.replace(/[^a-z0-9]/g, '');
        if (cleanWord.length > 3 && !['with', 'then', 'that', 'this', 'verify', 'assert', 'check'].includes(cleanWord)) {
          keywordsToFind.add(cleanWord);
        }
      }

      for (const keyword of keywordsToFind) {
        const match = elements.find((el: any) =>
          el.id.toLowerCase().includes(keyword) ||
          el.name.toLowerCase().includes(keyword) ||
          el.placeholder.toLowerCase().includes(keyword) ||
          el.ariaLabel.toLowerCase().includes(keyword) ||
          (el.text.toLowerCase().includes(keyword) && el.text.length > 0 && el.text.length < 50)
        );

        if (match && match.selector) {
          if (!match.selector.includes(':')) {
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

  private cleanJsonOutput(output: string): string {
    const trimmed = output.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    return (fenced ? fenced[1] : trimmed).trim();
  }

  private createFallbackSteps(req: any): any[] {
    if (Array.isArray(req.steps) && req.steps.length) {
      return this.normalizeSteps(req.steps);
    }

    const locators = { ...(req.locators ?? {}) };
    const testData = req.testData ?? {};
    
    const requirementParts = (
      Array.isArray(req.requirement)
        ? req.requirement
        : Array.isArray(req.requirements)
          ? req.requirements
          : [req.requirement ?? req.scenario ?? '']
    ).flatMap((part: any) => 
      String(part)
        .split(/(?:,|\band\b|then|;)+/i)
        .map(p => p.trim())
        .filter(Boolean)
    );

    const globalSteps: any[] = [];
    const usedKeys = new Set<string>();
    const usedTargets = new Set<string>();

    // 1. Navigate is always first
    if (req.applicationUrl || process.env.BASE_URL) {
      globalSteps.push({
        action: 'navigate',
        target: 'applicationUrl',
        value: req.applicationUrl ?? process.env.BASE_URL
      });
      usedKeys.add('applicationUrl');
      usedTargets.add('applicationUrl');
    }

    // 2. Add Login Preconditions if needed
    const hasLoginReq = requirementParts.some((part: any) => /login|log\s*in|signin|sign\s*in/i.test(String(part).toLowerCase()));
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
        action: 'fill',
        target: 'emailField',
        value: testData.loginEmail ?? testData.email ?? 'admin'
      });
      globalSteps.push({
        action: 'fill',
        target: 'passwordField',
        value: testData.loginPassword ?? testData.password ?? 'admin'
      });
      globalSteps.push({
        action: 'click',
        target: 'signInButton'
      });
      usedTargets.add('emailField');
      usedTargets.add('passwordField');
      usedTargets.add('signInButton');
    }

    // 3. Process each requirement part for 21 levels of actions
    for (const part of requirementParts) {
      const partText = String(part).toLowerCase();
      if (!partText.trim() || /login|log\s*in|signin|sign\s*in/i.test(partText)) continue;

      // Level 16: API Automation
      if (/api|http|post|get|put|delete/i.test(partText)) {
        globalSteps.push({
          action: 'api',
          method: partText.includes('post') ? 'POST' : (partText.includes('delete') ? 'DELETE' : 'GET'),
          url: '/api/v1/resource',
          expectedStatus: 200
        });
        continue;
      }

      // Level 17: Database Actions
      if (/database|query|db|sql/i.test(partText)) {
        globalSteps.push({
          action: 'db',
          query: 'SELECT * FROM users LIMIT 1;'
        });
        continue;
      }

      // Level 15: File Validations
      if (/pdf/i.test(partText)) {
        globalSteps.push({
          action: 'validatepdf',
          value: 'downloads/document.pdf'
        });
        continue;
      }
      if (/excel|xlsx/i.test(partText)) {
        globalSteps.push({
          action: 'validateexcel',
          value: 'downloads/report.xlsx'
        });
        continue;
      }
      if (/zip/i.test(partText)) {
        globalSteps.push({
          action: 'validatezip',
          value: 'downloads/archive.zip'
        });
        continue;
      }

      // Level 15: File Downloads / Uploads
      if (/download/i.test(partText)) {
        globalSteps.push({
          action: 'downloadfile',
          target: 'downloadButton',
          value: 'downloads'
        });
        if (!locators.downloadButton) locators.downloadButton = "//button[contains(text(),'Download')]";
        continue;
      }
      if (/upload|attach/i.test(partText)) {
        globalSteps.push({
          action: 'uploadfile',
          target: 'uploadInput',
          value: 'storage/sample.txt'
        });
        if (!locators.uploadInput) locators.uploadInput = "//input[@type='file']";
        continue;
      }

      // Level 2: Mouse Hover / Scroll
      if (/hover/i.test(partText)) {
        globalSteps.push({
          action: 'hover',
          target: 'menuItem'
        });
        if (!locators.menuItem) locators.menuItem = "//a[contains(text(),'Menu')]";
        continue;
      }
      if (/scroll/i.test(partText)) {
        globalSteps.push({
          action: 'scroll',
          target: 'pageFooter'
        });
        if (!locators.pageFooter) locators.pageFooter = "footer";
        continue;
      }

      // Level 12: Alert Dialogs
      if (/alert|dialog|popup/i.test(partText)) {
        globalSteps.push({
          action: 'acceptalert',
          target: 'triggerAlertButton'
        });
        if (!locators.triggerAlertButton) locators.triggerAlertButton = "//button[contains(text(),'Alert')]";
        continue;
      }

      // Level 21: Data Generation
      if (/random|generate/i.test(partText)) {
        globalSteps.push({
          action: 'generaterandomdata',
          type: partText.includes('email') ? 'email' : (partText.includes('phone') ? 'phone' : 'string'),
          saveAs: 'randomValue'
        });
        continue;
      }

      // Default Form / Input Handling
      const partSteps: Array<{ index: number, stepObj: any }> = [];
      const isFormPart = /create|add|new|fill|form|enter|register|submit|save/i.test(partText);

      for (const [key, value] of Object.entries(testData)) {
        if (value === undefined || value === null || usedKeys.has(key)) continue;

        let idx = this.findKeywordIndex(key, partText);
        const isFormKey = !/email|username|password|credential|login|signin/i.test(key);

        if (isFormKey && !isFormPart) continue;

        if (idx === -1) {
          if (isFormKey && isFormPart) idx = 9000;
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

      // Process locators for this part
      for (const key of Object.keys(locators)) {
        if (usedTargets.has(key) || key === 'applicationUrl' || /emailField|passwordField|signInButton/i.test(key)) continue;

        let idx = this.findKeywordIndex(key, partText);
        const isFormLocator = /add|create|new|save|submit|field|input|textarea|dropdown|select/i.test(key);
        if (isFormLocator && !isFormPart) continue;

        if (idx === -1) {
          if (isFormPart && /save|submit|add|create/i.test(key)) idx = 9500;
          else continue;
        }

        const normalizedKey = key.toLowerCase();
        let action = 'click';
        let val: any = undefined;

        if (/message|success|error|warning|result|dashboard|header|title|expected|element|verify|assert/i.test(normalizedKey)) {
          action = req.expectedText ? 'assertText' : 'assertVisible';
          val = req.expectedText ?? 'visible';
        }

        partSteps.push({
          index: idx,
          stepObj: { action, target: key, value: val }
        });
        usedTargets.add(key);
      }

      // Sort steps
      partSteps.sort((a, b) => {
        if (a.index !== b.index) return a.index - b.index;
        const actionA = String(a.stepObj.action).toLowerCase();
        const actionB = String(b.stepObj.action).toLowerCase();
        const targetA = String(a.stepObj.target).toLowerCase();
        const targetB = String(b.stepObj.target).toLowerCase();

        const isAddClickA = actionA === 'click' && /add|create|new/i.test(targetA) && !/save|submit/i.test(targetA);
        const isAddClickB = actionB === 'click' && /add|create|new/i.test(targetB) && !/save|submit/i.test(targetB);

        if (isAddClickA && !isAddClickB) return -1;
        if (!isAddClickA && isAddClickB) return 1;

        const isClickA = actionA === 'click';
        const isClickB = actionB === 'click';
        const isAssertA = actionA.startsWith('assert') || actionA.startsWith('verify');
        const isAssertB = actionB.startsWith('assert') || actionB.startsWith('verify');

        if (isClickA && !isClickB) return isAssertB ? -1 : 1;
        if (!isClickA && isClickB) return isAssertA ? 1 : -1;
        if (isAssertA && !isAssertB) return 1;
        if (!isAssertA && isAssertB) return -1;
        return 0;
      });

      for (const s of partSteps) {
        globalSteps.push(s.stepObj);
      }

      // Automatically inject verify step (Real Tester Practice)
      const hasAssertion = partSteps.some(s => s.stepObj.action.startsWith('assert') || s.stepObj.action.startsWith('verify'));
      if (!hasAssertion && (partText.includes('verify') || partText.includes('assert') || partText.includes('check') || partText.includes('display') || partText.includes('success'))) {
        const verifyTarget = Object.keys(locators).find(k =>
          k.toLowerCase() !== 'applicationurl' &&
          !/email|password|login|signin/i.test(k) &&
          this.findKeywordIndex(k, partText) !== -1
        );

        if (verifyTarget) {
          globalSteps.push({ action: 'assertVisible', target: verifyTarget });
          usedTargets.add(verifyTarget);
        } else {
          const words = this.significantWords(partText);
          // Dynamically infer the best word from the requirement to verify (excluding generic verbs)
          const genericVerbs = ['create', 'add', 'new', 'submit', 'save', 'update', 'delete', 'verify', 'assert', 'check', 'success', 'successfully'];
          const targetNoun = words.find(w => !genericVerbs.includes(w)) || words[0] || 'success';
          
          let defaultText = targetNoun.charAt(0).toUpperCase() + targetNoun.slice(1);
          let locatorKey = `${defaultText.toLowerCase()}PageLocator`;

          globalSteps.push({ action: 'assertVisible', target: locatorKey });
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

  private findKeywordIndex(key: string, text: string): number {
    const normalizedKey = key.toLowerCase();
    let idx = text.indexOf(normalizedKey);
    if (idx !== -1) return idx;

    // Try splitting camelCase
    const splitKey = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    idx = text.indexOf(splitKey);
    if (idx !== -1) return idx;

    // Filter out generic modifiers and find the most significant word
    const genericModifiers = ['valid', 'invalid', 'existing', 'new', 'create', 'enter', 'field', 'button', 'input', 'select', 'click'];
    const words = splitKey.split(' ').filter(w => !genericModifiers.includes(w));
    
    // Try matching the words in the text
    for (const word of words) {
      if (word.length > 2) {
        const wordIdx = text.indexOf(word);
        if (wordIdx !== -1) return wordIdx;
      }
    }
    
    // Fallback to the first non-generic word if nothing else matches
    const firstNonGeneric = splitKey.split(' ').find(w => !genericModifiers.includes(w));
    if (firstNonGeneric && firstNonGeneric.length > 3) {
      return text.indexOf(firstNonGeneric);
    }

    return -1;
  }

  private inferInputAction(key: string, requirement: string): string {
    if (/country|state|type|category|dropdown|select/i.test(key)) return 'select';
    if (/search|query|keyword/i.test(key) || requirement.includes('search')) return 'fill';
    return 'fill';
  }

  private locatorSearchText(key: string, selector: string): string {
    return `${key} ${selector}`
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .toLowerCase();
  }

  private significantWords(value: string): string[] {
    const stopWords = new Set(['the', 'a', 'an', 'to', 'for', 'of', 'and', 'item', 'items', 'product', 'products']);
    return (value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').match(/[a-zA-Z0-9]+/g) ?? [])
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 1 && !stopWords.has(word));
  }

  private normalizeLocatorAliases(locatorsInput: unknown): Record<string, string> {
    if (!locatorsInput || typeof locatorsInput !== 'object') return {};

    const locators = Object.fromEntries(
      Object.entries(locatorsInput as Record<string, unknown>)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value).trim()])
        .filter(([, value]) => value.length > 0)
    );

    return locators;
  }

  private findLocatorValue(locators: Record<string, string>, candidates: string[], pattern?: RegExp): string | undefined {
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

    return undefined;
  }

  private pickLocatorTarget(locators: Record<string, string>, candidates: string[]): string | undefined {
    for (const candidate of candidates) {
      if (locators[candidate]) return candidate;
    }

    const normalizedCandidates = new Set(candidates.map((candidate) => this.normalizeKey(candidate)));
    const match = Object.keys(locators).find((key) => normalizedCandidates.has(this.normalizeKey(key)));
    if (match) return match;

    // Smart matching: if a candidate word contains or is contained by a locator key
    for (const candidate of candidates) {
      const normCand = this.normalizeKey(candidate);
      const subMatch = Object.keys(locators).find((key) => {
        const normKey = this.normalizeKey(key);
        return normKey.includes(normCand) || normCand.includes(normKey);
      });
      if (subMatch) return subMatch;
    }

    // Generic keyword matching (last resort)
    for (const candidate of candidates) {
      const normCand = this.normalizeKey(candidate);
      // Login is a universal concept; we keep it to prevent matching 'loginEmail' with generic 'contactEmail'
      const isLoginCand = /email|username|password|credential|login|signin/i.test(normCand);
      
      const genericMatch = Object.keys(locators).find((key) => {
        const normKey = this.normalizeKey(key);
        
        const isLoginLocator = /emailField$|passwordField$|signInButton$/i.test(key) || (normKey === 'email' || normKey === 'password' || normKey === 'username');
        
        // Prevent cross-matching login credentials with general app forms
        if (isLoginCand && !isLoginLocator && normKey.length > normCand.length + 3) {
           return false;
        }
        if (!isLoginCand && isLoginLocator) {
          return false;
        }

        return (normCand.includes('email') && normKey.includes('email'))
          || (normCand.includes('pass') && normKey.includes('pass'))
          || (normCand.includes('user') && normKey.includes('user'))
          || (normCand.includes('mail') && normKey.includes('mail'));
      });
      if (genericMatch) return genericMatch;
    }

    return undefined;
  }

  private normalizeKey(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private readPriority(value: Record<string, any>, fallback: number): number {
    const raw = value.priority ?? value.order ?? value.sequence ?? value.rank;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private normalizeDependsOn(value: unknown): string[] {
    if (value === undefined || value === null || value === false) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((entry) => typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? String((entry as Record<string, unknown>).key ?? (entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).requirement ?? '')
          : '')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private reindexSteps(steps: any[]): any[] {
    return steps.map((step, index) => ({
      ...step,
      step: index + 1,
    }));
  }

  private normalizeSteps(steps: any[]): any[] {
    return steps.map((step, index) => ({
      ...step,
      step: step.step ?? index + 1,
      target: step.target ?? '',
      value: step.value ?? '',
    }));
  }
}
