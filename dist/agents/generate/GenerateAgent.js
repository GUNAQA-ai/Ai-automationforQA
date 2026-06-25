"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GenerateAgent = void 0;
const fs_extra_1 = require("fs-extra");
const crypto_1 = require("crypto");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../../utils/logger"));
const LLMProvider_1 = require("../../framework/LLMProvider");
const FrameworkError_1 = require("../../framework/FrameworkError");
const Config_1 = require("../../framework/Config");
class GenerateAgent {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.generatedDir = path_1.default.resolve('generated');
        this.pagesDir = path_1.default.resolve('generated', 'pages');
        this.locatorsDir = path_1.default.resolve('generated', 'locators');
        this.testsDir = path_1.default.resolve('generated', 'tests');
        this.promptPath = path_1.default.resolve('prompts', 'generation.txt');
        this.historyPath = path_1.default.resolve('storage', 'healing-history.json');
        this.artifactIndexPath = path_1.default.resolve('generated', '.artifact-index.json');
        this.apiStatePath = path_1.default.resolve('storage', 'api-state.json');
    }
    async run(planPath, executionError) {
        try {
            let plan = await this.applyApiStateToPlan(JSON.parse(await (0, fs_extra_1.readFile)(planPath, 'utf-8')));
            plan = await this.normalizePlan(plan);
            const planFingerprint = this.planFingerprint(plan);
            const reusableSpec = executionError ? undefined : await this.findReusableGeneratedSpec(plan, planFingerprint);
            if (reusableSpec) {
                this.logger.info(`GenerateAgent: reusing existing generated spec ${reusableSpec}`);
                return reusableSpec;
            }
            if (plan.locators && typeof plan.locators === 'object' && Object.keys(plan.locators).length > 0) {
                plan.locators = await this.applyHealingHistoryToLocators(plan.locators);
            }
            const provider = LLMProvider_1.LLMProviderFactory.getProvider();
            const template = await (0, fs_extra_1.readFile)(this.promptPath, 'utf-8');
            let prompt = template.replace('{{PLAN_JSON}}', JSON.stringify(plan, null, 2));
            if (executionError) {
                prompt += `\n\n---\nPREVIOUS RUN FAILURE FEEDBACK:\nThe previously generated code failed during execution with the following error/log:\n${executionError}\n\nPlease fix the test steps, actions, or imports in your response to resolve this issue.`;
            }
            this.logger.info(`GenerateAgent: using prompt template ${this.promptPath}`);
            let rawOutput = '';
            try {
                rawOutput = await provider.generate(prompt);
            }
            catch (err) {
                this.logger.warn('GenerateAgent: prompt execution failed; using structured local fallback from plan', { error: err });
            }
            const parsedOutput = this.parsePromptOutput(rawOutput);
            const promptSpec = this.normalizeSpecCode(parsedOutput.testSpec);
            let supportFiles = this.resolveSupportFiles(parsedOutput, promptSpec);
            if (plan.locators && typeof plan.locators === 'object' && Object.keys(plan.locators).length > 0) {
                supportFiles = this.applyPlanLocatorsToImportedFiles(supportFiles, promptSpec, plan.locators, plan.applicationUrl, plan.scenario, plan.testData);
                this.logger.info(`GenerateAgent: using ${Object.keys(plan.locators).length} user-provided locators from request JSON, including applicationUrl`);
            }
            supportFiles = this.pruneSupportFilesToImportGraph(supportFiles, promptSpec);
            const fallbackBundle = this.generateStructuredFallback(plan);
            const acceptedPromptSpec = Boolean(promptSpec
                && this.hasPageAndLocatorSupport(supportFiles)
                && this.pageSupportUsesFrameworkHelpers(supportFiles)
                && this.isValidGeneratedCode(promptSpec, plan, supportFiles));
            const filesToWrite = acceptedPromptSpec ? supportFiles : fallbackBundle.supportFiles;
            const generatedCode = this.ensureMinimumTestTimeout(this.addExecutionLogsToSpec(acceptedPromptSpec
                ? this.normalizeSpecImports(promptSpec, supportFiles)
                : fallbackBundle.testSpec));
            if (acceptedPromptSpec) {
                this.logger.info('GenerateAgent: accepted TEST_SPEC section from prompt output');
            }
            else if (!rawOutput.trim()) {
                this.logger.warn('GenerateAgent: prompt output was empty; using local fallback spec from plan');
            }
            else if (!parsedOutput.testSpec) {
                this.logger.warn('GenerateAgent: prompt output did not contain a usable TEST_SPEC section; using local fallback spec from plan');
            }
            else {
                this.logger.warn(`GenerateAgent: TEST_SPEC section was not runnable (${this.getInvalidReason(parsedOutput.testSpec, plan, supportFiles)}); using structured local fallback from plan`);
            }
            this.validateGeneratedCode(generatedCode, filesToWrite, plan);
            this.logger.info('GenerateAgent: preserving existing generated files and writing collision-safe new files');
            await (0, fs_extra_1.ensureDir)(this.pagesDir);
            await (0, fs_extra_1.ensureDir)(this.locatorsDir);
            await (0, fs_extra_1.ensureDir)(this.testsDir);
            const sanitizedScenarioName = this.deriveClassName(plan.scenario || 'GeneratedTest');
            const filePlan = await this.planGeneratedWrites(filesToWrite, `${sanitizedScenarioName}.spec.ts`, plan);
            const remappedSupportFiles = this.remapSupportFiles(filesToWrite, filePlan.supportFileNames);
            const remappedGeneratedCode = this.rewriteGeneratedImportsForUniqueFiles(generatedCode, filePlan.supportFileNames);
            const specPath = path_1.default.join(this.testsDir, filePlan.specFileName);
            await this.writeSupportFiles(remappedSupportFiles);
            await (0, fs_extra_1.writeFile)(specPath, remappedGeneratedCode);
            await this.recordGeneratedArtifact(plan, planPath, planFingerprint, specPath, remappedSupportFiles);
            this.logger.info(`Generated spec at ${specPath}`);
            return specPath;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error('GenerateAgent failed', { error: msg });
            if (err instanceof FrameworkError_1.FrameworkError) {
                throw err;
            }
            throw new FrameworkError_1.FrameworkError('Generation failed', err);
        }
    }
    async normalizePlan(plan) {
        const scenario = this.scenarioText(plan.scenario ?? plan.requirement ?? plan.testName, 'Generated scenario');
        const requirements = this.requirementItems(plan.requirements ?? plan.scenario ?? plan.requirement ?? plan.testName);
        const applicationUrl = plan.applicationUrl ?? this.inferApplicationUrlFromSteps(plan.steps) ?? process.env.BASE_URL;
        const baseLocators = this.prepareFallbackLocators({ ...plan, applicationUrl });
        let domLocators = {};
        if (Config_1.Config.get().aiEnabled) {
            domLocators = await this.discoverLocatorsFromDom({ ...plan, scenario, applicationUrl }, baseLocators);
        }
        else {
            this.logger.info('AI is disabled. Skipping DOM locator discovery.');
        }
        const locators = this.normalizeLocatorAliases({
            ...domLocators,
            ...baseLocators,
        });
        const normalized = {
            ...plan,
            scenario,
            applicationUrl,
            locators,
        };
        if (requirements.length > 1 && !Array.isArray(normalized.requirements)) {
            normalized.requirements = requirements;
        }
        normalized.steps = this.filterStepsToResolvedLocators(Array.isArray(normalized.steps) ? normalized.steps : [], normalized.locators, normalized.testData);
        return normalized;
    }
    scenarioText(value, fallback = 'Generated scenario') {
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
    async applyApiStateToPlan(plan) {
        const apiState = await this.readApiState();
        if (!apiState)
            return plan;
        const resolvedPlan = this.resolveTemplatesInObject(plan, {
            apiState,
            api: apiState.responses ?? {},
            values: apiState.values ?? {},
            ...(apiState.values ?? {}),
        });
        if (JSON.stringify(resolvedPlan) !== JSON.stringify(plan)) {
            this.logger.info(`GenerateAgent: resolved plan placeholders from ${path_1.default.relative(process.cwd(), this.apiStatePath)}`);
        }
        return resolvedPlan;
    }
    async readApiState() {
        try {
            if (!await (0, fs_extra_1.pathExists)(this.apiStatePath))
                return undefined;
            const parsed = JSON.parse(await (0, fs_extra_1.readFile)(this.apiStatePath, 'utf-8'));
            return parsed && typeof parsed === 'object' ? parsed : undefined;
        }
        catch {
            this.logger.warn(`GenerateAgent: ignoring unreadable API state ${this.apiStatePath}`);
            return undefined;
        }
    }
    resolveTemplatesInObject(value, context) {
        if (typeof value === 'string')
            return this.resolveTemplateString(value, context);
        if (Array.isArray(value))
            return value.map((entry) => this.resolveTemplatesInObject(entry, context));
        if (!value || typeof value !== 'object')
            return value;
        return Object.fromEntries(Object.entries(value)
            .map(([key, entry]) => [key, this.resolveTemplatesInObject(entry, context)]));
    }
    resolveTemplateString(value, context) {
        const exactPlaceholder = value.match(/^\$\{([^}]+)\}$/);
        if (exactPlaceholder) {
            const resolved = this.lookupTemplateValue(exactPlaceholder[1].trim(), context);
            if (resolved !== undefined && resolved !== null)
                return resolved;
        }
        return value.replace(/\$\{([^}]+)\}/g, (match, expression) => {
            const resolved = this.lookupTemplateValue(String(expression).trim(), context);
            if (resolved === undefined || resolved === null)
                return match;
            return typeof resolved === 'string' ? resolved : JSON.stringify(resolved);
        });
    }
    lookupTemplateValue(expression, context) {
        if (/^env:/i.test(expression)) {
            return process.env[expression.replace(/^env:/i, '')];
        }
        return context[expression] ?? this.readContextPath(context, expression) ?? process.env[expression];
    }
    readContextPath(value, selector) {
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
    async findReusableGeneratedSpec(plan, planFingerprint) {
        const index = await this.readArtifactIndex();
        const scenarioKey = this.scenarioKey(plan);
        const reusable = index.entries.find((entry) => (entry.planFingerprint === planFingerprint
            && entry.scenarioKey === scenarioKey));
        if (!reusable)
            return undefined;
        const specPath = this.resolveIndexedPath(reusable.specPath);
        const supportFiles = reusable.supportFiles.map((file) => this.resolveIndexedPath(file));
        const allFiles = [specPath, ...supportFiles];
        if (!allFiles.every((file) => this.isShortVisibleFileName(file)))
            return undefined;
        const allExist = (await Promise.all(allFiles.map((file) => (0, fs_extra_1.pathExists)(file)))).every(Boolean);
        return allExist ? specPath : undefined;
    }
    async recordGeneratedArtifact(plan, planPath, planFingerprint, specPath, supportFiles) {
        await (0, fs_extra_1.ensureDir)(this.generatedDir);
        const index = await this.readArtifactIndex();
        const scenarioKey = this.scenarioKey(plan);
        const supportFilePaths = Object.keys(supportFiles).map((fileName) => {
            const targetDir = this.isLocatorSupportFile(fileName, supportFiles[fileName]) ? this.locatorsDir : this.pagesDir;
            return this.relativePath(path_1.default.join(targetDir, fileName));
        });
        const nextEntry = {
            planFingerprint,
            scenarioKey,
            scenario: this.scenarioText(plan.scenario, 'Generated scenario'),
            planPath: this.relativePath(planPath),
            specPath: this.relativePath(specPath),
            supportFiles: supportFilePaths,
            generatedAt: new Date().toISOString(),
        };
        index.entries = [
            ...index.entries.filter((entry) => !(entry.planFingerprint === planFingerprint && entry.scenarioKey === scenarioKey)),
            nextEntry,
        ];
        await (0, fs_extra_1.writeFile)(this.artifactIndexPath, JSON.stringify(index, null, 2));
    }
    async readArtifactIndex() {
        try {
            const raw = await (0, fs_extra_1.readFile)(this.artifactIndexPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && Array.isArray(parsed.entries)) {
                return {
                    version: Number(parsed.version) || 1,
                    entries: parsed.entries.filter((entry) => Boolean(entry && typeof entry === 'object')),
                };
            }
        }
        catch {
            // Missing or unreadable index is fine; new runs will recreate it.
        }
        return { version: 1, entries: [] };
    }
    resolveIndexedPath(filePath) {
        return path_1.default.isAbsolute(filePath) ? filePath : path_1.default.resolve(filePath);
    }
    relativePath(filePath) {
        return path_1.default.relative(process.cwd(), path_1.default.resolve(filePath)).split(path_1.default.sep).join('/');
    }
    planFingerprint(plan) {
        const stablePlan = {
            scenario: this.scenarioText(plan.scenario, ''),
            env: plan.env ?? plan.environment ?? 'default',
            applicationUrl: plan.applicationUrl ?? '',
            steps: Array.isArray(plan.steps) ? plan.steps : [],
            locators: plan.locators ?? {},
            testData: plan.testData ?? {},
        };
        return (0, crypto_1.createHash)('sha256')
            .update(this.stableStringify(stablePlan))
            .digest('hex')
            .slice(0, 20);
    }
    scenarioKey(plan) {
        return this.normalizeKey(`${plan.applicationUrl ?? ''}:${this.scenarioText(plan.scenario, 'Generated scenario')}`);
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
    generateStructuredFallback(plan) {
        const className = this.deriveClassName(plan.scenario || 'GeneratedTest');
        const locatorExport = `${className}Locators`;
        const locatorKeyType = this.locatorKeyTypeName(locatorExport);
        const pageClass = `${className}Page`;
        const locators = this.prepareFallbackLocators(plan);
        const locatorFileName = `${className}Locators.ts`;
        const pageFileName = `${className}Page.ts`;
        return {
            supportFiles: {
                [locatorFileName]: this.buildLocatorsFromPlan(locators, plan.applicationUrl, locatorExport, '', plan.testData),
                [pageFileName]: this.buildStructuredPageObject(pageClass, locatorExport, locatorKeyType, plan, locators),
            },
            testSpec: this.buildStructuredSpec(plan, pageClass, locatorExport, locators),
        };
    }
    buildStructuredPageObject(pageClass, locatorExport, locatorKeyType, plan, locators) {
        const steps = Array.isArray(plan.steps) && plan.steps.length
            ? plan.steps
            : [{ action: 'navigate', target: 'applicationUrl' }];
        const methodNames = this.buildMethodNamesForSteps(steps);
        const methods = steps
            .map((step, index) => this.buildPageMethodForStep(step, methodNames[index], locators, plan.testData))
            .filter(Boolean)
            .join('\n\n');
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
        const action = String(step?.action || '').toLowerCase();
        if (this.isDataOnlyItemsStep(step, testData))
            return '';
        const targetKey = this.resolveLocatorKey(String(step?.target ?? ''), locators);
        const keyExpression = targetKey ? `this.locators.${targetKey}` : '';
        const keyLiteral = targetKey ? JSON.stringify(targetKey) : '';
        const valueParameter = this.stepUsesValueParameter(action) ? ', value: string' : '';
        switch (action) {
            case 'navigate':
                return `  async ${methodName}(): Promise<void> {
    await this.navigateTo(${targetKey ? keyExpression : 'this.locators.applicationUrl'});
  }`;
            case 'acceptalert':
            case 'acceptdialog':
            case 'clickandacceptalert':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.acceptAlert(${keyExpression}, value);
  }`;
            case 'dismissalert':
            case 'dismissdialog':
            case 'clickanddismissalert':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.dismissAlert(${keyExpression}, value);
  }`;
            case 'verifyvisible':
            case 'assertvisible':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.verifyVisible(${keyExpression}, 10000);
  }`;
            case 'verifyenabled':
            case 'assertenabled':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.verifyEnabled(${keyExpression}, 10000);
  }`;
            case 'asserthidden':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.verifyHidden(${keyExpression}, 10000);
  }`;
            case 'fill':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.fill(${keyExpression}, value);
  }`;
            case 'click':
            case 'logout':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.click(${keyExpression});
  }`;
            case 'clickifvisible':
            case 'closeifvisible':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.clickIfVisible(${keyExpression});
  }`;
            case 'select':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.select(${keyExpression}, value);
  }`;
            case 'selectbytext':
            case 'choose':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.selectByText(${keyExpression}, value);
  }`;
            case 'fillandchoose':
            case 'autocomplete':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.fillAndChoose(${keyExpression}, value);
  }`;
            case 'check':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.check(${keyExpression});
  }`;
            case 'uncheck':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.uncheck(${keyExpression});
  }`;
            case 'press':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.press(${keyExpression}, value);
  }`;
            case 'hover':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.hover(${keyExpression});
  }`;
            case 'uploadfile':
            case 'upload':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.uploadFile(${keyExpression}, value);
  }`;
            case 'draganddrop':
            case 'dragdrop':
            case 'drag':
                if (!targetKey)
                    return '';
                const dropTargetKey = this.resolveSecondaryTargetKey(step, locators);
                if (!dropTargetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.dragAndDrop(${keyExpression}, this.locators.${dropTargetKey});
  }`;
            case 'asserttext':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.verifyText(${keyExpression}, value, 10000);
  }`;
            case 'assertvalue':
                if (!targetKey)
                    return '';
                return `  async ${methodName}(${valueParameter.slice(2)}): Promise<void> {
    await this.actions.verifyValue(${keyExpression}, value, 10000);
  }`;
            default:
                if (!targetKey)
                    return '';
                return `  async ${methodName}(): Promise<void> {
    await this.actions.verifyVisible(${keyExpression}, 10000);
  }`;
        }
    }
    buildStructuredSpec(plan, pageClass, locatorExport, locators) {
        const scenario = this.scenarioText(plan.scenario, 'Generated scenario');
        const pageVar = `${pageClass.charAt(0).toLowerCase()}${pageClass.slice(1)}`;
        const testDataExport = this.testDataExportName(locatorExport);
        const steps = Array.isArray(plan.steps) && plan.steps.length
            ? plan.steps
            : [{ action: 'navigate', target: 'applicationUrl' }];
        const methodNames = this.buildMethodNamesForSteps(steps);
        const body = steps
            .map((step, index) => this.buildStructuredStep(step, index, pageVar, locatorExport, locators, plan.testData, methodNames[index], testDataExport))
            .filter(Boolean)
            .join('\n\n');
        return `import { test, expect } from '@playwright/test';
import { ${pageClass} } from '../pages/${pageClass}';
import { ${locatorExport}, ${testDataExport} } from '../locators/${locatorExport}';

test(${JSON.stringify(scenario)}, async ({ page }) => {
  test.setTimeout(60000);
  const ${pageVar} = new ${pageClass}(page);

${body || `  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });`}
});
`;
    }
    buildStructuredStep(step, index, pageVar, locatorExport, locators, testData, methodName, testDataExport) {
        const action = String(step?.action || '').toLowerCase();
        if (this.isDataOnlyItemsStep(step, testData))
            return '';
        const targetKey = this.resolveLocatorKey(String(step?.target ?? ''), locators);
        const value = this.resolveStepValue(step, testData);
        const valueExpression = this.stepValueExpression(step, value, testData, testDataExport);
        const callName = methodName || this.methodNameForStep(step, index);
        const title = this.friendlyStepTitle(step, index, callName);
        let code = '';
        switch (action) {
            case 'navigate':
                const expectedUrl = targetKey ? `${locatorExport}.${targetKey}` : `${locatorExport}.applicationUrl`;
                code = `await ${pageVar}.${callName}();
    await expect(page).toHaveURL(${expectedUrl});`;
                break;
            case 'verifyvisible':
            case 'assertvisible':
            case 'verifyenabled':
            case 'assertenabled':
            case 'asserthidden':
            case 'click':
            case 'logout':
            case 'check':
            case 'uncheck':
            case 'hover':
            case 'clickifvisible':
            case 'closeifvisible':
                if (!targetKey)
                    return '';
                code = `await ${pageVar}.${callName}();`;
                break;
            case 'fill':
            case 'select':
            case 'selectbytext':
            case 'choose':
            case 'fillandchoose':
            case 'autocomplete':
            case 'uploadfile':
            case 'upload':
            case 'asserttext':
            case 'assertvalue':
            case 'acceptalert':
            case 'acceptdialog':
            case 'clickandacceptalert':
            case 'dismissalert':
            case 'dismissdialog':
            case 'clickanddismissalert':
                if (!targetKey)
                    return '';
                code = `await ${pageVar}.${callName}(${valueExpression});`;
                break;
            case 'press':
                if (!targetKey)
                    return '';
                code = `await ${pageVar}.${callName}(${value ? valueExpression : JSON.stringify('Enter')});`;
                break;
            case 'draganddrop':
            case 'dragdrop':
            case 'drag':
                if (!targetKey || !this.resolveSecondaryTargetKey(step, locators))
                    return '';
                code = `await ${pageVar}.${callName}();`;
                break;
            case 'asserturl':
                code = `await expect(page).toHaveURL(${JSON.stringify(String(value || step?.target || ''))});`;
                break;
            default:
                if (!targetKey)
                    return '';
                code = `await ${pageVar}.${callName}();`;
        }
        return `  await test.step(${JSON.stringify(title)}, async () => {
    ${code}
  });`;
    }
    buildMethodNamesForSteps(steps) {
        const used = new Set();
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
        const action = String(step?.action || 'step').toLowerCase();
        const target = String(step?.target || '');
        const value = String(step?.value || '');
        const targetName = this.toPascalName(target) || `Seq${index + 1}`;
        const valueName = this.toPascalName(value);
        const friendlyTargetName = this.friendlyTargetName(target) || `Seq${index + 1}`;
        const normalizedTarget = this.normalizeKey(target);
        switch (action) {
            case 'navigate':
                return normalizedTarget && normalizedTarget !== 'applicationurl'
                    ? `navigateTo${this.navigationTargetName(target) || friendlyTargetName}`
                    : 'navigateToApplication';
            case 'fill':
                return `enter${friendlyTargetName}`;
            case 'click':
            case 'clickifvisible':
            case 'closeifvisible':
                if (/close|dismiss|skip/i.test(target))
                    return `close${friendlyTargetName}IfVisible`;
                if (/admin|module|menu|nav|tab|link/i.test(target))
                    return `open${friendlyTargetName}`;
                if (/add|create|new/i.test(target))
                    return `open${friendlyTargetName}Form`;
                if (/save/i.test(target))
                    return `save${friendlyTargetName}`;
                if (/submit/i.test(target))
                    return `submit${friendlyTargetName}`;
                if (/search/i.test(target))
                    return `search${friendlyTargetName}`;
                return `select${friendlyTargetName}`;
            case 'select':
                return `select${friendlyTargetName}`;
            case 'selectbytext':
            case 'choose':
                return `choose${friendlyTargetName}`;
            case 'fillandchoose':
            case 'autocomplete':
                return `choose${friendlyTargetName}`;
            case 'check':
                return `check${targetName}`;
            case 'uncheck':
                return `uncheck${targetName}`;
            case 'press':
                return `press${targetName}`;
            case 'acceptalert':
            case 'acceptdialog':
            case 'clickandacceptalert':
                return `accept${friendlyTargetName}Alert`;
            case 'dismissalert':
            case 'dismissdialog':
            case 'clickanddismissalert':
                return `dismiss${friendlyTargetName}Alert`;
            case 'hover':
                return `hover${targetName}`;
            case 'uploadfile':
            case 'upload':
                return `upload${targetName}`;
            case 'draganddrop':
            case 'dragdrop':
            case 'drag':
                return `drag${targetName}To${this.toPascalName(this.secondaryTargetName(step)) || 'Target'}`;
            case 'verifyenabled':
            case 'assertenabled':
                return `verify${targetName}Enabled`;
            case 'verifyvisible':
            case 'assertvisible':
                return `verify${valueName || targetName}Visible`;
            case 'asserthidden':
                return `verify${targetName}Hidden`;
            case 'asserttext':
                return `verify${valueName || friendlyTargetName}Text`;
            case 'assertvalue':
                return `verify${targetName}Value`;
            case 'logout':
                return `logoutFrom${targetName}`;
            default:
                return `verify${targetName}`;
        }
    }
    toPascalName(value) {
        return (value.match(/[a-zA-Z0-9]+/g) ?? [])
            .slice(0, 5)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }
    navigationTargetName(target) {
        try {
            const url = new URL(target);
            const route = url.pathname
                .split('/')
                .map((part) => part.trim())
                .filter(Boolean)
                .pop();
            const name = this.toPascalName(route || url.hostname.split('.')[0] || 'Application');
            return name ? `${name}Page` : 'Application';
        }
        catch {
            return this.toPascalName(target);
        }
    }
    friendlyTargetName(value) {
        const words = (value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').match(/[a-zA-Z0-9]+/g) ?? [])
            .filter((word) => !/^(input|button|btn|dropdown|field|locator|element)$/i.test(word));
        return words
            .slice(0, 5)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }
    stepUsesValueParameter(action) {
        return [
            'fill',
            'select',
            'selectbytext',
            'choose',
            'fillandchoose',
            'autocomplete',
            'press',
            'uploadfile',
            'upload',
            'asserttext',
            'assertvalue',
            'acceptalert',
            'acceptdialog',
            'clickandacceptalert',
            'dismissalert',
            'dismissdialog',
            'clickanddismissalert',
        ].includes(action);
    }
    secondaryTargetName(step) {
        return String(step?.to
            ?? step?.dropTarget
            ?? step?.destination
            ?? step?.target2
            ?? step?.value
            ?? '');
    }
    resolveSecondaryTargetKey(step, locators) {
        return this.resolveLocatorKey(this.secondaryTargetName(step), locators);
    }
    isDataOnlyItemsStep(step, testData) {
        const action = String(step?.action ?? '').toLowerCase();
        const target = this.normalizeKey(String(step?.target ?? ''));
        return target === 'items'
            && ['fill', 'select', 'press'].includes(action)
            && this.normalizeItems(step?.value ?? testData?.items).length > 0;
    }
    normalizeItems(value) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item).trim()).filter(Boolean);
        }
        if (typeof value === 'string') {
            return value.split(',').map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }
    reindexSteps(steps) {
        return steps.map((step, index) => ({
            ...step,
            step: index + 1,
        }));
    }
    prepareFallbackLocators(plan) {
        const locators = this.normalizeLocatorAliases(plan?.locators);
        const applicationUrl = plan?.applicationUrl ?? this.inferApplicationUrlFromSteps(plan?.steps) ?? process.env.BASE_URL;
        if (applicationUrl)
            locators.applicationUrl = String(applicationUrl);
        for (const step of Array.isArray(plan?.steps) ? plan.steps : []) {
            const action = String(step?.action ?? '').toLowerCase();
            if (action === 'navigate' || action === 'asserturl')
                continue;
            if (this.isDataOnlyItemsStep(step, plan?.testData))
                continue;
            const target = String(step?.target ?? '').trim();
            if (target && !this.resolveLocatorKey(target, locators)) {
                const key = this.safeLocatorKey(target, action);
                if (this.looksLikeSelector(target)) {
                    locators[key] = target;
                }
                else {
                    // Generate a smart dynamic XPath placeholder
                    locators[key] = `//*[contains(text(), '${target}') or @id='${target}' or @name='${target}' or @placeholder='${target}']`;
                }
            }
            if (['draganddrop', 'dragdrop', 'drag'].includes(action)) {
                const secondaryTarget = this.secondaryTargetName(step).trim();
                if (secondaryTarget && !this.resolveLocatorKey(secondaryTarget, locators)) {
                    const key = this.safeLocatorKey(secondaryTarget, action);
                    if (this.looksLikeSelector(secondaryTarget)) {
                        locators[key] = secondaryTarget;
                    }
                    else {
                        locators[key] = `//*[contains(text(), '${secondaryTarget}') or @id='${secondaryTarget}']`;
                    }
                }
            }
        }
        return this.normalizeLocatorAliases(locators);
    }
    filterStepsToResolvedLocators(steps, locators, testData) {
        const droppedTargets = [];
        const filtered = steps.filter((step) => {
            if (!this.stepRequiresLocator(step, testData))
                return true;
            const target = String(step?.target ?? '').trim();
            if (target && this.resolveLocatorKey(target, locators)) {
                if (['draganddrop', 'dragdrop', 'drag'].includes(String(step?.action ?? '').toLowerCase())) {
                    return Boolean(this.resolveSecondaryTargetKey(step, locators));
                }
                return true;
            }
            droppedTargets.push(target || String(step?.action ?? 'unknown step'));
            return false;
        });
        if (droppedTargets.length) {
            this.logger.warn(`GenerateAgent: skipped ${droppedTargets.length} step(s) with no DOM-backed locator: ${droppedTargets.join(', ')}`);
        }
        return this.reindexSteps(filtered);
    }
    stepRequiresLocator(step, testData) {
        const action = String(step?.action ?? '').toLowerCase();
        if (!action || ['navigate', 'asserturl'].includes(action))
            return false;
        if (this.isDataOnlyItemsStep(step, testData))
            return false;
        return true;
    }
    async discoverLocatorsFromDom(plan, baseLocators) {
        return {};
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
    resolveLocatorKey(target, locators) {
        if (!target)
            return undefined;
        if (target !== 'applicationUrl' && locators[target])
            return target;
        const normalizedTarget = this.normalizeKey(target);
        const exactKey = Object.keys(locators)
            .filter((key) => key !== 'applicationUrl')
            .find((key) => this.normalizeKey(key) === normalizedTarget);
        if (exactKey)
            return exactKey;
        return Object.entries(locators)
            .find(([key, selector]) => key !== 'applicationUrl' && selector === target)?.[0];
    }
    looksLikeSelector(value) {
        return /^(\/\/|\.|#|\[|[a-z]+[#.\[]|[a-z]+:|[a-z]+\[)/i.test(value);
    }
    safeLocatorKey(target, action) {
        const words = target.match(/[a-zA-Z0-9]+/g) ?? [action, 'target'];
        const [first = action, ...rest] = words;
        return `${first.charAt(0).toLowerCase()}${first.slice(1)}${rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')}`;
    }
    resolveStepValue(step, testData) {
        if (step?.value !== undefined && step.value !== null && step.value !== '')
            return step.value;
        const targetKey = this.normalizeKey(String(step?.target ?? ''));
        if (testData) {
            const exact = Object.entries(testData).find(([key]) => this.normalizeKey(key) === targetKey);
            if (exact)
                return exact[1];
        }
        return step?.value;
    }
    stepValueExpression(step, value, testData, testDataExport) {
        const dataKey = this.findTestDataKeyForStep(step, value, testData);
        if (dataKey && testDataExport) {
            return `${testDataExport}${this.objectAccess(dataKey)}`;
        }
        return JSON.stringify(String(value ?? ''));
    }
    findTestDataKeyForStep(step, value, testData) {
        if (!testData || value === undefined || value === null || Array.isArray(value))
            return undefined;
        const targetKey = this.normalizeKey(String(step?.target ?? ''));
        const exactTarget = Object.keys(testData).find((key) => this.normalizeKey(key) === targetKey);
        if (exactTarget)
            return exactTarget;
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
        if (typeof step === 'string')
            return step.replace(/\s+/g, ' ').trim() || `Step ${index + 1}`;
        const action = this.humanizeLogText(String(step?.action || 'step'));
        const target = this.humanizeLogText(String(step?.target || ''));
        return [action, target].filter(Boolean).join(' ') || `Step ${index + 1}`;
    }
    friendlyStepTitle(step, index, methodName) {
        if (typeof step === 'string')
            return this.fallbackStepTitle(step, index);
        return methodName ? this.humanizeLogText(methodName) : this.fallbackStepTitle(step, index);
    }
    hasPageAndLocatorSupport(supportFiles) {
        const fileNames = Object.keys(supportFiles);
        return fileNames.some((fileName) => /page/i.test(fileName))
            && fileNames.some((fileName) => /locator/i.test(fileName));
    }
    pageSupportUsesFrameworkHelpers(supportFiles) {
        return Object.entries(supportFiles)
            .filter(([fileName]) => /page/i.test(fileName))
            .every(([, content]) => content.includes('BasePage') && content.includes('CommonActions'));
    }
    /**
     * Build a TypeScript locators object from the plan.locators map.
     * Keeps request selectors unchanged and carries applicationUrl into the locator layer.
     */
    buildLocatorsFromPlan(locators, applicationUrl, exportName, baseCode = '', testData) {
        const merged = {
            ...this.extractStringLocators(baseCode),
            ...Object.fromEntries(Object.entries(locators).map(([key, value]) => [key, String(value ?? '').trim()])),
        };
        merged.applicationUrl = String(applicationUrl || merged.applicationUrl || process.env.BASE_URL || '').trim();
        const orderedEntries = [
            ['applicationUrl', merged.applicationUrl],
            ...Object.entries(merged).filter(([key]) => key !== 'applicationUrl'),
        ];
        const entries = orderedEntries.map(([key, value]) => `  ${this.formatObjectKey(key)}: ${JSON.stringify(value)},`);
        return `export const ${exportName} = {\n${entries.join('\n')}\n} as const;

export const ${this.testDataExportName(exportName)} = ${this.stringifyObjectLiteral(testData ?? {})} as const;

export type ${this.locatorKeyTypeName(exportName)} = Exclude<keyof typeof ${exportName}, 'applicationUrl'>;
`;
    }
    testDataExportName(locatorExport) {
        return locatorExport.endsWith('Locators')
            ? `${locatorExport.slice(0, -'Locators'.length)}TestData`
            : `${locatorExport}TestData`;
    }
    stringifyObjectLiteral(value) {
        const json = JSON.stringify(value ?? {}, null, 2);
        return json.replace(/^/gm, '  ').trimStart();
    }
    locatorKeyTypeName(locatorExport) {
        return locatorExport.endsWith('Locators')
            ? `${locatorExport.slice(0, -'Locators'.length)}LocatorKey`
            : `${locatorExport}Key`;
    }
    applyPlanLocatorsToImportedFiles(supportFiles, testSpec, locators, applicationUrl, scenario, testData) {
        const updated = { ...supportFiles };
        const targets = this.getLocatorImportTargets(updated);
        if (!targets.length) {
            const scenarioClass = this.deriveClassName(scenario);
            const locatorFileName = `${scenarioClass}Locators.ts`;
            updated[locatorFileName] = this.buildLocatorsFromPlan(locators, applicationUrl, `${scenarioClass}Locators`, updated[locatorFileName], testData);
            this.logger.warn(`GenerateAgent: no imported locator file was detected; prepared ${locatorFileName}`);
            return updated;
        }
        for (const target of targets) {
            updated[target.fileName] = this.buildLocatorsFromPlan(locators, applicationUrl, target.exportName, updated[target.fileName], testData);
            this.logger.info(`GenerateAgent: request locators applied to imported file ${target.fileName}`);
        }
        return this.ensureDirectSpecLocatorImports(updated, testSpec, locators, applicationUrl, scenario, testData);
    }
    ensureDirectSpecLocatorImports(supportFiles, testSpec, locators, applicationUrl, scenario, testData) {
        const updated = { ...supportFiles };
        const directImports = this.getLocatorImportTargets({ TestSpec: testSpec });
        if (!directImports.length)
            return updated;
        const fallbackExportName = `${this.deriveClassName(scenario)}Locators`;
        for (const target of directImports) {
            updated[target.fileName] = this.buildLocatorsFromPlan(locators, applicationUrl, target.exportName || fallbackExportName, updated[target.fileName], testData);
            this.logger.info(`GenerateAgent: request locators applied to direct spec import ${target.fileName}`);
        }
        return updated;
    }
    getLocatorImportTargets(supportFiles) {
        const targets = new Map();
        for (const content of Object.values(supportFiles)) {
            const importRegex = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g;
            for (const match of content.matchAll(importRegex)) {
                const importPath = match[2];
                if (!/locator/i.test(importPath) && !/locator/i.test(path_1.default.basename(importPath)))
                    continue;
                const fileName = this.toSupportFileName(importPath);
                for (const importedName of match[1].split(',')) {
                    const exportName = importedName.trim().split(/\s+as\s+/i)[0]?.trim();
                    if (!exportName || !/locator/i.test(exportName))
                        continue;
                    const key = `${fileName}:${exportName}`;
                    if (!targets.has(key))
                        targets.set(key, { fileName, exportName });
                }
            }
        }
        return Array.from(targets.values());
    }
    pruneSupportFilesToImportGraph(files, entryCode) {
        const keep = new Set();
        const visit = (code) => {
            for (const importName of this.getRelativeImportNames(code)) {
                const fileName = this.toSupportFileName(importName);
                if (!files[fileName] || keep.has(fileName))
                    continue;
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
        for (const line of code.split(/\r?\n/)) {
            const match = line.match(/^\s*([A-Za-z_$][\w$]*|['"][^'"]+['"])\s*:\s*(['"`])(.*)\2\s*,?\s*$/);
            if (!match)
                continue;
            const rawKey = match[1].replace(/^['"]|['"]$/g, '');
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
            }
            catch {
                return rawValue;
            }
        }
        return rawValue.replace(/\\(['"`\\])/g, '$1');
    }
    formatObjectKey(key) {
        return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    }
    async applyHealingHistoryToLocators(locators) {
        const normalized = Object.fromEntries(Object.entries(locators).map(([key, value]) => [key, String(value ?? '').trim()]));
        let rawHistory = '';
        try {
            rawHistory = await (0, fs_extra_1.readFile)(this.historyPath, 'utf-8');
        }
        catch {
            return normalized;
        }
        let history = [];
        try {
            history = JSON.parse(rawHistory);
        }
        catch {
            this.logger.warn('GenerateAgent: healing history could not be parsed; using request locators as-is');
            return normalized;
        }
        const healedSelectorMap = new Map();
        for (const entry of history) {
            const oldSelector = String(entry.oldSelector ?? '').trim();
            const newSelector = String(entry.newSelector ?? '').trim();
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
        return (specificCollection && broadTarget) || this.selectorIntentMismatch(oldSelector, newSelector);
    }
    selectorIntentMismatch(oldSelector, newSelector) {
        const oldIntent = this.selectorIntent(oldSelector);
        const newIntent = this.selectorIntent(newSelector);
        return Boolean(oldIntent && newIntent && oldIntent !== newIntent);
    }
    selectorIntent(selector) {
        const normalized = selector.toLowerCase();
        if (/password|passwo|id=["']pass(?:word|rd)?["']|type=["']password|type='password'/.test(normalized))
            return 'password-input';
        if (/user.?name|email|type=["']email|type='email'/.test(normalized))
            return 'text-input';
        if (/login|submit|save|button|\bbtn\b/.test(normalized))
            return 'button';
        if (/cart|shopping/.test(normalized))
            return 'cart';
        if (/title|header|heading|h1|h2/.test(normalized))
            return 'heading';
        return undefined;
    }
    toSupportFileName(importName) {
        const baseName = path_1.default.basename(importName);
        return baseName.endsWith('.ts') ? baseName : `${baseName}.ts`;
    }
    /** Derive a PascalCase class name from the scenario text */
    deriveClassName(scenario) {
        const words = this.scenarioText(scenario, 'GeneratedTest')
            .replace(/[^a-zA-Z0-9\s]/g, ' ')
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
        return this.compactFileBase(selected.length ? selected : words.slice(0, 2), 8) || 'Test';
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
        return output || 'Test'.slice(0, safeMaxLength);
    }
    hasWords(words, expectedWords) {
        const normalizedWords = new Set(words.map((word) => word.toLowerCase()));
        return expectedWords.every((word) => normalizedWords.has(word));
    }
    parsePromptOutput(output) {
        const cleaned = this.cleanGeneratedCode(output);
        return {
            locators: this.cleanSectionCode(this.extractSection(cleaned, 'LOCATORS')),
            pageObject: this.cleanSectionCode(this.extractSection(cleaned, 'PAGE_OBJECT')),
            testSpec: this.cleanSectionCode(this.extractSection(cleaned, 'TEST_SPEC') || cleaned),
        };
    }
    cleanGeneratedCode(output) {
        const trimmed = output.trim();
        const fenced = trimmed.match(/^```(?:ts|typescript)?\s*([\s\S]*?)\s*```$/i);
        return (fenced ? fenced[1] : trimmed).trim();
    }
    extractSection(output, sectionName) {
        const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = output.match(new RegExp(`(?:\\*\\*)?\\s*(?:OPTIONAL\\s+)?SECTION:\\s*${escaped}\\s*(?:\\*\\*)?\\s*([\\s\\S]*?)(?=\\n\\s*(?:\\*\\*)?\\s*(?:OPTIONAL\\s+)?SECTION:\\s*[A-Z_]+|$)`, 'i'));
        return (match ? match[1] : '').trim();
    }
    cleanSectionCode(section) {
        let cleaned = section.trim();
        cleaned = cleaned.replace(/^\*\*\s*/g, '').replace(/\s*\*\*$/g, '').trim();
        const fenced = cleaned.match(/^```(?:ts|typescript|javascript|js)?\s*([\s\S]*?)\s*```$/i);
        if (fenced) {
            cleaned = fenced[1].trim();
        }
        else {
            cleaned = cleaned.replace(/^```(?:ts|typescript|javascript|js)?\s*/i, '').replace(/\s*```$/i, '').trim();
        }
        cleaned = cleaned
            .split(/\r?\n/)
            .filter((line) => !/^\s*```/.test(line) && !/^\s*\*\*\s*$/.test(line))
            .join('\n')
            .trim();
        const importIndex = cleaned.indexOf('import ');
        if (importIndex > 0) {
            cleaned = cleaned.slice(importIndex).trim();
        }
        return cleaned;
    }
    validateGeneratedCode(code, supportFiles = {}, plan) {
        if (!code) {
            throw new FrameworkError_1.FrameworkError('Generated code is empty', undefined, 'GEN_EMPTY');
        }
        if (!this.isValidGeneratedCode(code, plan, supportFiles)) {
            throw new FrameworkError_1.FrameworkError(`Generated code does not contain a runnable Playwright test: ${this.getInvalidReason(code, plan, supportFiles)}`, undefined, 'GEN_INVALID');
        }
    }
    isValidGeneratedCode(code, plan, supportFiles = {}) {
        return Boolean(code &&
            code.includes('@playwright/test') &&
            /\btest\s*\(/.test(code) &&
            !/```|\*\*/.test(code) &&
            !this.usesPageObjectInternals(code) &&
            !this.usesGenericPageObjectApi(supportFiles) &&
            !this.usesMissingFrameworkActions(supportFiles) &&
            this.supportFilesAreValid(supportFiles) &&
            this.generatedIdentifiersAreResolved(code, supportFiles) &&
            this.relativeImportsAreSatisfied(code, supportFiles) &&
            this.generatedCodeCoversPlan(code, plan, supportFiles));
    }
    getInvalidReason(code, plan, supportFiles = {}) {
        if (!code)
            return 'missing TEST_SPEC code';
        if (/```|\*\*/.test(code))
            return 'contains markdown wrappers';
        if (!code.includes('@playwright/test'))
            return 'missing @playwright/test import';
        if (!/\btest\s*\(/.test(code))
            return 'missing test() block';
        if (!this.hasPageAndLocatorSupport(supportFiles))
            return 'missing generated page or locator support file';
        if (!this.pageSupportUsesFrameworkHelpers(supportFiles))
            return 'generated page object does not use framework helpers';
        if (this.usesPageObjectInternals(code))
            return 'test spec accesses private page object internals';
        if (this.usesGenericPageObjectApi(supportFiles))
            return 'generated page object uses confusing generic locator methods';
        if (this.usesMissingFrameworkActions(supportFiles))
            return 'generated page object calls framework actions that do not exist';
        if (!this.supportFilesAreValid(supportFiles))
            return 'generated support files contain invalid TypeScript or unsupported locator code';
        const unresolved = this.findUnresolvedGeneratedIdentifiers([code, ...Object.values(supportFiles)]).join(', ');
        if (unresolved)
            return `contains unresolved generated identifier(s): ${unresolved}`;
        if (!this.relativeImportsAreSatisfied(code, supportFiles))
            return 'imports generated files that were not returned in prompt sections';
        const coverageFailure = this.getPlanCoverageFailure(code, plan, supportFiles);
        if (coverageFailure)
            return coverageFailure;
        return 'unknown validation failure';
    }
    generatedCodeCoversPlan(code, plan, supportFiles = {}) {
        return !this.getPlanCoverageFailure(code, plan, supportFiles);
    }
    getPlanCoverageFailure(code, plan, supportFiles = {}) {
        const steps = this.executablePlanSteps(plan);
        if (!steps.length)
            return undefined;
        const generatedStepCount = (code.match(/\bawait\s+test\.step\s*\(/g) ?? []).length;
        if (generatedStepCount < steps.length) {
            return `generated spec has ${generatedStepCount} test.step block(s) for ${steps.length} executable plan step(s)`;
        }
        const generatedText = this.coverageText([code, ...Object.values(supportFiles)]);
        const expectedMethodNames = this.buildMethodNamesForSteps(steps);
        const missingMethods = expectedMethodNames.filter((methodName) => !this.includesCoveragePhrase(generatedText, methodName));
        if (missingMethods.length) {
            return `missing generated method(s) for plan step coverage: ${missingMethods.slice(0, 5).join(', ')}`;
        }
        const missingFamilies = this.requiredActionFamilies(steps)
            .filter((family) => !this.coverageHasActionFamily(generatedText, family));
        if (missingFamilies.length) {
            return `missing action flow coverage: ${missingFamilies.join(', ')}`;
        }
        return undefined;
    }
    executablePlanSteps(plan) {
        return (Array.isArray(plan?.steps) ? plan.steps : [])
            .filter((step) => !this.isDataOnlyItemsStep(step, plan?.testData));
    }
    coverageText(contents) {
        return contents
            .join('\n')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    includesCoveragePhrase(text, value) {
        const phrase = this.coverageText([value]);
        return Boolean(phrase) && text.includes(phrase);
    }
    requiredActionFamilies(steps) {
        return Array.from(new Set(steps.map((step) => this.actionFamily(step)).filter((family) => Boolean(family))));
    }
    actionFamily(step) {
        const action = String(step?.action ?? '').toLowerCase();
        if (action === 'navigate' || action === 'asserturl')
            return 'navigate';
        if (action === 'fill')
            return 'fill';
        if (action === 'click' || action === 'logout' || action === 'clickifvisible' || action === 'closeifvisible')
            return 'click';
        if (['select', 'selectbytext', 'choose', 'fillandchoose', 'autocomplete'].includes(action))
            return 'select';
        if (action === 'check' || action === 'uncheck')
            return 'check';
        if (action === 'press')
            return 'press';
        if (action === 'hover')
            return 'hover';
        if (action === 'uploadfile' || action === 'upload')
            return 'upload';
        if (['draganddrop', 'dragdrop', 'drag'].includes(action))
            return 'dragdrop';
        if (['acceptalert', 'acceptdialog', 'clickandacceptalert', 'dismissalert', 'dismissdialog', 'clickanddismissalert'].includes(action))
            return 'alert';
        if (['verifyvisible', 'assertvisible', 'verifyenabled', 'assertenabled', 'asserthidden', 'asserttext', 'assertvalue', 'assert', 'verify'].includes(action))
            return 'assert';
        return undefined;
    }
    coverageHasActionFamily(text, family) {
        const familyTerms = {
            navigate: ['navigate', 'goto'],
            fill: ['fill', 'enter'],
            click: ['click', 'open', 'select'],
            select: ['select', 'choose'],
            check: ['check', 'uncheck'],
            press: ['press'],
            hover: ['hover'],
            upload: ['upload', 'set input files'],
            dragdrop: ['drag and drop', 'drag drop', 'drag'],
            alert: ['accept alert', 'dismiss alert', 'dialog'],
            assert: ['verify', 'assert', 'expect'],
        };
        return (familyTerms[family] ?? [family]).some((term) => this.includesCoveragePhrase(text, term));
    }
    usesPageObjectInternals(code) {
        return /\b[A-Za-z_$][\w$]*Page\.(?:page|locators)\b/.test(code);
    }
    usesGenericPageObjectApi(supportFiles) {
        return Object.entries(supportFiles)
            .filter(([fileName]) => /page/i.test(fileName))
            .some(([, content]) => {
            return /\b(?:element|key|selector)\s*:\s*string\b/.test(content)
                || /this\.locators\[\s*(?:element|key|selector)\s*\]/.test(content)
                || /\bfillItems\s*\(/.test(content)
                || /\b[A-Za-z_$][\w$]*Step\d+\s*\(/.test(content)
                || /\basync\s+(?:click|fill|clear)[A-Z][A-Za-z0-9_]*\s*\(/.test(content)
                || /\bthis\.page\.(?:goto|locator|click|fill|press|selectOption|check|uncheck|hover|dragAndDrop|setInputFiles)\s*\(/.test(content)
                || /\.(?:click|fill|press|selectOption|check|uncheck|hover|dragTo|setInputFiles)\s*\(/.test(content.replace(/this\.actions\.(?:click|clickIfVisible|fill|press|select|check|uncheck|hover|dragAndDrop|uploadFile)\s*\(/g, ''))
                || /\bexpect\s*\(\s*(?:this\.)?page\.locator\(/.test(content);
        });
    }
    usesMissingFrameworkActions(supportFiles) {
        return Object.entries(supportFiles)
            .filter(([fileName]) => /page/i.test(fileName))
            .some(([, content]) => /\bthis\.actions\.assert(?:Visible|Enabled|Hidden|Text|Value)\s*\(/.test(content));
    }
    generatedIdentifiersAreResolved(code, supportFiles) {
        return this.findUnresolvedGeneratedIdentifiers([code, ...Object.values(supportFiles)]).length === 0;
    }
    findUnresolvedGeneratedIdentifiers(contents) {
        const unresolved = new Set();
        for (const code of contents) {
            const available = new Set([
                ...this.getImportedIdentifiers(code),
                ...this.getDeclaredIdentifiers(code),
            ]);
            const identifiers = Array.from(code.matchAll(/\b[A-Z][A-Za-z0-9_]*(?:Page|Locators?|Actions|Helpers)\b/g))
                .map((match) => match[0]);
            for (const identifier of identifiers) {
                if (!available.has(identifier))
                    unresolved.add(identifier);
            }
        }
        return Array.from(unresolved);
    }
    getImportedIdentifiers(code) {
        const identifiers = [];
        for (const match of code.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"][^'"]+['"];?/g)) {
            identifiers.push(...match[1]
                .split(',')
                .map((name) => name.trim().split(/\s+as\s+/i).pop() ?? '')
                .filter(Boolean));
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
        return Array.from(code.matchAll(/\b(?:export\s+)?(?:abstract\s+)?(?:class|const|let|var|function|enum|interface|type)\s+([A-Za-z_$][\w$]*)/g))
            .map((match) => match[1]);
    }
    resolveSupportFiles(parsedOutput, testSpec) {
        const files = {};
        const imports = this.getRelativeImportNames(testSpec);
        const pageBlocks = this.splitGeneratedBlocks(parsedOutput.pageObject || '', 'PageObject.ts');
        const locatorBlocks = this.splitGeneratedBlocks(parsedOutput.locators || '', 'GeneratedLocators.ts');
        for (const importName of imports) {
            const baseName = path_1.default.basename(importName, path_1.default.extname(importName));
            const fileName = this.toSupportFileName(importName);
            if (/locator/i.test(baseName) && parsedOutput.locators) {
                files[fileName] = this.normalizeSupportCode(locatorBlocks[fileName] || parsedOutput.locators);
            }
            else if (/page/i.test(baseName) && parsedOutput.pageObject) {
                files[fileName] = this.normalizeSupportCode(pageBlocks[fileName] || parsedOutput.pageObject);
            }
        }
        for (const [fileName, content] of Object.entries(pageBlocks)) {
            if (!files[fileName])
                files[fileName] = this.normalizeSupportCode(content);
        }
        const nestedLocatorImports = Object.values(files).flatMap((content) => this.getRelativeImportNames(content)).filter((name) => /locator/i.test(name));
        for (const importName of nestedLocatorImports) {
            const fileName = this.toSupportFileName(importName);
            if (parsedOutput.locators && !files[fileName]) {
                files[fileName] = this.normalizeSupportCode(locatorBlocks[fileName] || parsedOutput.locators);
            }
        }
        for (const [fileName, content] of Object.entries(locatorBlocks)) {
            if (!files[fileName] && /locator/i.test(fileName))
                files[fileName] = this.normalizeSupportCode(content);
        }
        return files;
    }
    splitGeneratedBlocks(code, fallbackFileName) {
        const cleaned = code.trim();
        if (!cleaned)
            return {};
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
            if (content)
                files[marker[1]] = content;
        }
        return files;
    }
    normalizeSupportCode(code) {
        let normalized = code
            // Normalize any variant of BasePage import to the correct relative path from generated/pages/
            .replace(/from\s+['"](?:\.\.\/)*(?:src\/)?framework\/BasePage['"]/g, "from '../../src/framework/BasePage'")
            .replace(/from\s+['"](?:\.\.\/)*(?:src\/)?framework\/CommonActions['"]/g, "from '../../src/framework/CommonActions'")
            .replace(/from\s+['"](?:\.\.\/)*(?:src\/)?framework\/WaitHelpers['"]/g, "from '../../src/framework/WaitHelpers'")
            .replace(/from\s+['"](?:\.\.\/)*(?:src\/)?utils\/logger['"]/g, "from '../../src/utils/logger'")
            .replace(/waitFor\(\{\s*state:\s*['"]enabled['"]\s*\}\)/g, "waitFor({ state: 'visible' })")
            .replace(/waitFor\(\{\s*state:\s*['"]disabled['"]\s*\}\)/g, "waitFor({ state: 'hidden' })")
            .replace(/(\.locator\([^)]+\))(?!\.first\(\))\.waitFor\(/g, '$1.first().waitFor(');
        normalized = this.removeUnusedRelativeImports(normalized);
        if (/\bexpect\s*\(/.test(normalized) && !/import\s+\{[^}]*\bexpect\b[^}]*\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
            if (/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
                normalized = normalized.replace(/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/, (_match, imports) => {
                    const names = imports.split(',').map((name) => name.trim()).filter(Boolean);
                    if (!names.includes('expect'))
                        names.push('expect');
                    return `import { ${names.join(', ')} } from '@playwright/test'`;
                });
            }
            else {
                normalized = `import { expect } from '@playwright/test';\n${normalized}`;
            }
        }
        if (/\bPage\b/.test(normalized) && !/import\s+\{[^}]*\bPage\b[^}]*\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
            if (/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/.test(normalized)) {
                normalized = normalized.replace(/import\s+\{([^}]*)\}\s+from\s+['"]@playwright\/test['"]/, (_match, imports) => {
                    const names = imports.split(',').map((name) => name.trim()).filter(Boolean);
                    if (!names.includes('Page'))
                        names.push('Page');
                    return `import { ${names.join(', ')} } from '@playwright/test'`;
                });
            }
            else {
                normalized = `import { Page } from '@playwright/test';\n${normalized}`;
            }
        }
        return normalized.replace(/page\.goto\(([^,\n]+)\)/g, "page.goto($1, { waitUntil: 'domcontentloaded', timeout: 30000 })");
    }
    removeUnusedRelativeImports(code) {
        const lines = code.split(/\r?\n/);
        const body = lines.filter((line) => !/^\s*import\s+/.test(line)).join('\n');
        return lines
            .filter((line) => {
            const match = line.match(/^\s*import\s+\{([^}]+)\}\s+from\s+['"](\.\/[^'"]+)['"];?\s*$/);
            if (!match)
                return true;
            const importedNames = match[1].split(',').map((name) => name.trim().split(/\s+as\s+/i).pop() || '').filter(Boolean);
            return importedNames.some((name) => new RegExp(`\\b${name}\\b`).test(body));
        })
            .join('\n');
    }
    async planGeneratedWrites(supportFiles, specFileName, plan) {
        const reserved = new Set();
        const supportFileNames = {};
        for (const fileName of Object.keys(supportFiles)) {
            const targetDir = this.isLocatorSupportFile(fileName, supportFiles[fileName]) ? this.locatorsDir : this.pagesDir;
            supportFileNames[fileName] = await this.generatedFileNameForScenario(targetDir, fileName, reserved, plan);
        }
        return {
            supportFileNames,
            specFileName: await this.generatedFileNameForScenario(this.testsDir, specFileName, reserved, plan),
        };
    }
    async generatedFileNameForScenario(targetDir, fileName, reserved, plan) {
        const ext = fileName.endsWith('.spec.ts') ? '.spec.ts' : path_1.default.extname(fileName);
        const base = this.shortGeneratedBaseName(path_1.default.basename(fileName, ext), ext, '');
        const candidate = `${base}${ext}`;
        const candidatePath = path_1.default.join(targetDir, candidate);
        if (!reserved.has(candidatePath) && await (0, fs_extra_1.pathExists)(candidatePath) && !await this.indexedToDifferentScenario(candidatePath, plan)) {
            reserved.add(candidatePath);
            return candidate;
        }
        return this.uniqueGeneratedFileName(targetDir, fileName, reserved);
    }
    async indexedToDifferentScenario(filePath, plan) {
        const index = await this.readArtifactIndex();
        const relative = this.relativePath(filePath);
        const scenarioKey = this.scenarioKey(plan);
        return index.entries.some((entry) => (entry.scenarioKey !== scenarioKey
            && (entry.specPath === relative || entry.supportFiles.includes(relative))));
    }
    async uniqueGeneratedFileName(targetDir, fileName, reserved) {
        const ext = fileName.endsWith('.spec.ts') ? '.spec.ts' : path_1.default.extname(fileName);
        const base = this.shortGeneratedBaseName(path_1.default.basename(fileName, ext), ext, '');
        let candidate = `${base}${ext}`;
        let index = 2;
        let candidatePath = path_1.default.join(targetDir, candidate);
        while (reserved.has(candidatePath) || await (0, fs_extra_1.pathExists)(candidatePath)) {
            const suffix = `_${index}`;
            candidate = `${this.shortGeneratedBaseName(path_1.default.basename(fileName, ext), ext, suffix)}${suffix}${ext}`;
            candidatePath = path_1.default.join(targetDir, candidate);
            index += 1;
        }
        reserved.add(candidatePath);
        return candidate;
    }
    shortGeneratedBaseName(baseName, ext, suffix) {
        const maxVisibleLength = 60;
        const maxBaseLength = Math.max(1, maxVisibleLength - ext.length - suffix.length);
        const cleanBaseName = baseName.replace(/[^a-zA-Z0-9]/g, '');
        if (/Locators$/i.test(cleanBaseName)) {
            const suffixText = 'Locators';
            const scenarioBase = cleanBaseName.replace(/Locators$/i, '');
            return `${this.compactFileBase([scenarioBase], maxBaseLength - suffixText.length)}${suffixText}`;
        }
        if (/Page$/i.test(cleanBaseName)) {
            const suffixText = 'Page';
            const scenarioBase = cleanBaseName.replace(/Page$/i, '');
            return `${this.compactFileBase([scenarioBase], maxBaseLength - suffixText.length)}${suffixText}`;
        }
        return this.compactFileBase([cleanBaseName], maxBaseLength);
    }
    isShortVisibleFileName(file) {
        return path_1.default.basename(file).length <= 60;
    }
    remapSupportFiles(files, fileNameMap) {
        return Object.fromEntries(Object.entries(files).map(([fileName, content]) => [
            fileNameMap[fileName] ?? fileName,
            this.rewriteGeneratedImportsForUniqueFiles(content, fileNameMap),
        ]));
    }
    rewriteGeneratedImportsForUniqueFiles(code, fileNameMap) {
        return code.replace(/from\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (match, quote, importName) => {
            const normalizedImport = String(importName).replace(/\\/g, '/');
            if (normalizedImport.includes('src/framework') || normalizedImport.includes('src/utils'))
                return match;
            const oldFileName = this.toSupportFileName(normalizedImport);
            const newFileName = fileNameMap[oldFileName];
            if (!newFileName || newFileName === oldFileName)
                return match;
            const importDir = path_1.default.posix.dirname(normalizedImport);
            const newBase = path_1.default.basename(newFileName, path_1.default.extname(newFileName));
            const newImport = importDir === '.' ? `./${newBase}` : `${importDir}/${newBase}`;
            return `from ${quote}${newImport}${quote}`;
        });
    }
    async writeSupportFiles(files) {
        for (const [fileName, content] of Object.entries(files)) {
            const isLocatorFile = this.isLocatorSupportFile(fileName, content);
            const targetDir = isLocatorFile ? this.locatorsDir : this.pagesDir;
            const normalizedContent = isLocatorFile
                ? content
                : this.addExecutionLogsToActions(this.normalizePageImports(content));
            const filePath = path_1.default.join(targetDir, fileName);
            await (0, fs_extra_1.writeFile)(filePath, normalizedContent);
            this.logger.info(`Generated support file at ${filePath}`);
        }
    }
    isLocatorSupportFile(fileName, content = '') {
        return /locator|loc\./i.test(fileName)
            || /\bexport\s+const\s+\w+Locators\b/.test(content)
            || /\bexport\s+type\s+\w+LocatorKey\b/.test(content);
    }
    normalizeSpecImports(code, supportFiles) {
        // Handle both './' and '../pages/' or '../locators/' style imports from the LLM
        return code.replace(/from\s+['"](\.\.?\/[^'"]+)['"]/g, (_match, importName) => {
            const base = path_1.default.basename(importName, path_1.default.extname(importName));
            const fileName = this.toSupportFileName(importName);
            // Framework paths — keep as-is
            if (importName.includes('src/framework') || importName.includes('src/utils')) {
                return `from '${importName}'`;
            }
            if (!supportFiles[fileName])
                return `from '${importName}'`;
            const folder = /locator/i.test(fileName) ? 'locators' : 'pages';
            return `from '../${folder}/${base}'`;
        });
    }
    normalizePageImports(code) {
        return code.replace(/from\s+['"](\.\.?\/[^'"]+)['"]/g, (_match, importName) => {
            // Framework paths — keep as-is
            if (importName.includes('src/framework') || importName.includes('src/utils')) {
                return `from '${importName}'`;
            }
            const base = path_1.default.basename(importName, path_1.default.extname(importName));
            const folder = /locator/i.test(importName) ? '../locators' : '.';
            return `from '${folder}/${base}'`;
        });
    }
    relativeImportsAreSatisfied(code, supportFiles) {
        const allCode = [code, ...Object.values(supportFiles)];
        return allCode.flatMap((content) => this.getRelativeImportNames(content)).every((importName) => {
            const normalized = importName.replace(/\\/g, '/');
            // Allow all framework and utility imports
            if (normalized.includes('src/framework') || normalized.includes('src/utils'))
                return true;
            if (normalized.startsWith('../src/') || normalized.startsWith('../../src/'))
                return true;
            const fileName = this.toSupportFileName(normalized);
            return Boolean(supportFiles[fileName]);
        });
    }
    supportFilesAreValid(supportFiles) {
        if (Object.keys(supportFiles).length === 0)
            return true;
        return Object.values(supportFiles).every((content) => {
            if (/```|\*\*/.test(content))
                return false;
            if (!content.trim())
                return false;
            return true;
        });
    }
    getRelativeImportNames(code) {
        // Match all relative imports: ./, ../, ../../ etc.
        return Array.from(code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)).map((match) => match[1]);
    }
    normalizeSpecCode(code) {
        if (!code)
            return code;
        let normalized = this.trimAfterFinalTestBlock(code).replace(/page\.goto\(([^,\n]+)\)/g, "page.goto($1, { waitUntil: 'domcontentloaded', timeout: 30000 })");
        if (!/test\.setTimeout\(/.test(normalized)) {
            normalized = normalized.replace(/(test\([^\n]*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\r?\n)/, '$1  test.setTimeout(60000);\n');
        }
        return normalized;
    }
    addExecutionLogsToSpec(code) {
        return code.replace(/^(\s*)await\s+test\.step\(\s*(['"`])([^'"`]+)\2\s*,\s*async\s*\(\)\s*=>\s*\{\s*$/gm, (line, indent, _quote, title) => {
            const message = `\x1b[36m[STEP]\x1b[0m ${this.humanizeLogText(title)}`;
            return `${line}\n${indent}  console.log(${JSON.stringify(message)});`;
        });
    }
    ensureMinimumTestTimeout(code, minimumMs = 60000) {
        if (/test\.setTimeout\(\s*\d+\s*\)/.test(code)) {
            return code.replace(/test\.setTimeout\(\s*(\d+)\s*\)/, (_match, timeout) => {
                return `test.setTimeout(${Math.max(Number(timeout), minimumMs)})`;
            });
        }
        return code.replace(/(test\([^\n]*async\s*\(\s*\{\s*page\s*\}\s*\)\s*=>\s*\{\r?\n)/, `$1  test.setTimeout(${minimumMs});\n`);
    }
    addExecutionLogsToActions(code) {
        const lines = code.split(/\r?\n/);
        const output = [];
        for (const line of lines) {
            const message = this.getActionLogMessage(line);
            if (message) {
                const indent = line.match(/^\s*/)?.[0] ?? '';
                output.push(`${indent}console.log(${JSON.stringify(message)});`);
            }
            output.push(line);
        }
        return output.join('\n');
    }
    getActionLogMessage(line) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('await '))
            return undefined;
        const locatorKey = this.humanizeLogText(line.match(/(?:this\.)?locators\.([A-Za-z_$][\w$]*)/)?.[1]
            ?? line.match(/\b[A-Za-z_$][\w$]*Locators\.([A-Za-z_$][\w$]*)/)?.[1]
            ?? 'target element');
        if (/\.goto\(/.test(line)) {
            return `\x1b[35m[ACTION]\x1b[0m Opening browser and navigating to application`;
        }
        if (/\.fill\(/.test(line)) {
            return `\x1b[35m[ACTION]\x1b[0m Entering ${locatorKey}`;
        }
        if (/\.click\(/.test(line)) {
            return `\x1b[35m[ACTION]\x1b[0m Clicking ${locatorKey}`;
        }
        if (/\.selectOption\(/.test(line)) {
            return `\x1b[35m[ACTION]\x1b[0m Selecting ${locatorKey}`;
        }
        if (/\.press\(/.test(line)) {
            return `\x1b[35m[ACTION]\x1b[0m Pressing key on ${locatorKey}`;
        }
        return undefined;
    }
    humanizeLogText(value) {
        return value
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }
    trimAfterFinalTestBlock(code) {
        const lastTestClose = Math.max(code.lastIndexOf('\n});'), code.lastIndexOf('\r\n});'));
        if (lastTestClose === -1)
            return code;
        return code.slice(0, lastTestClose + code.slice(lastTestClose).indexOf('});') + 3).trim();
    }
    normalizeKey(value) {
        return value.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
}
exports.GenerateAgent = GenerateAgent;
//# sourceMappingURL=GenerateAgent.js.map