import { chromium, firefox, webkit, Browser, BrowserContext, Page } from '@playwright/test';
import { ensureDir } from 'fs-extra';
import path from 'path';
import Logger from '../utils/logger';
import { CommonActions } from './CommonActions';
import { ApiEngine } from './ApiEngine';
import { DataEngine } from './DataEngine';
import { WaitHelpers } from './WaitHelpers';

export interface TestStep {
  step: number;
  action: string;
  target?: string;
  value?: any;
  attributeName?: string;
  frame?: string;
  promptText?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url?: string;
  headers?: Record<string, string>;
  data?: any;
  expectedStatus?: number;
  expectedText?: string;
  query?: string;
  params?: any[];
  saveAs?: string;
  type?: string;
  // Dynamic fields for generic consolidated action routing
  actionType?: string;
  options?: Record<string, any>;
}

export interface TestSpec {
  name?: string;
  scenario?: string;
  description?: string;
  applicationUrl?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: { width: number; height: number };
  mobileEmulation?: string;
  locators?: Record<string, string>;
  testData?: Record<string, any>;
  steps: TestStep[];
}

/**
 * TestEngine - The high-level data-driven execution engine of the framework.
 * Orchestrates browser management, runs POM step actions, and handles 
 * synchronizations, assertions, API testing, database queries, and reports.
 * Integrated to route all 21 action levels directly to the new consolidated methods.
 */
export class TestEngine {
  private readonly logger = Logger.getInstance();
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private actions?: CommonActions;
  private api?: ApiEngine;
  private variables: Record<string, any> = {};

  /**
   * Run a data-driven test specification.
   */
  async runSpec(spec: TestSpec): Promise<{ passed: boolean; error?: Error; stepsExecuted: number }> {
    const specName = spec.name ?? spec.scenario ?? 'Unnamed_Spec';
    this.logger.info(`Starting execution of Test Spec: ${specName}`);
    let stepsExecuted = 0;

    try {
      // 1. Browser Management (Level 1)
      await this.launchBrowser(spec);

      // 2. Variable & Test Data Initialization
      this.variables = { ...(spec.testData ?? {}) };
      if (spec.applicationUrl) {
        this.variables['applicationUrl'] = spec.applicationUrl;
      }

      // 3. Action Context Initialization
      this.actions = new CommonActions(this.page!);
      this.api = new ApiEngine();
      await this.api.init(spec.applicationUrl);

      // 4. Step Execution Loop
      for (const step of spec.steps) {
        this.logger.info(`Executing step ${step.step}: ${step.action}`);
        await WaitHelpers.retryAsync(async () => {
          await this.executeStep(step, spec);
        }, 1, 500);
        stepsExecuted++;
      }

      this.logger.info(`Test Spec completed successfully: ${specName}`);
      return { passed: true, stepsExecuted };
    } catch (err) {
      this.logger.error(`Test Spec failed on step ${stepsExecuted + 1}`, { error: err });
      
      if (this.page) {
        const screenshotPath = `reports/screenshots/failure-${specName.replace(/\s+/g, '_')}-${Date.now()}.png`;
        await ensureDir(path.dirname(screenshotPath));
        await this.page.screenshot({ path: screenshotPath });
        this.logger.info(`Failure screenshot captured at: ${screenshotPath}`);
      }

      return { passed: false, error: err as Error, stepsExecuted };
    } finally {
      // 5. Cleanup
      await this.closeBrowser();
      if (this.api) {
        await this.api.dispose();
      }
    }
  }

  /**
   * Browser Management Engine (Level 1 Browser & Context Management)
   */
  private async launchBrowser(spec: TestSpec): Promise<void> {
    const headless = spec.headless ?? true;
    const browserType = spec.browser ?? 'chromium';
    this.logger.info(`Launching ${browserType} browser (headless: ${headless})`);

    const launchOptions = { headless };
    switch (browserType) {
      case 'firefox':
        this.browser = await firefox.launch(launchOptions);
        break;
      case 'webkit':
        this.browser = await webkit.launch(launchOptions);
        break;
      case 'chromium':
      default:
        this.browser = await chromium.launch(launchOptions);
        break;
    }

    const contextOptions: any = {
      recordVideo: { dir: 'reports/videos/' },
      viewport: spec.viewport ?? { width: 1280, height: 720 }
    };

    if (spec.mobileEmulation) {
      this.logger.info(`Applying mobile emulation device profile: ${spec.mobileEmulation}`);
      if (spec.mobileEmulation.toLowerCase().includes('phone') || spec.mobileEmulation.toLowerCase().includes('pixel')) {
        contextOptions.viewport = { width: 375, height: 812 };
        contextOptions.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1';
        contextOptions.deviceScaleFactor = 3;
        contextOptions.isMobile = true;
        contextOptions.hasTouch = true;
      }
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();
  }

  private async closeBrowser(): Promise<void> {
    this.logger.info('Closing browser and contexts');
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  /**
   * Core execution engine routing all actions to the new consolidated framework APIs.
   */
  private async executeStep(step: TestStep, spec: TestSpec): Promise<void> {
    const act = this.actions!;
    const locators = spec.locators ?? {};

    const getSelector = (targetName?: string): string => {
      if (!targetName) return '';
      return locators[targetName] ?? targetName;
    };

    const resolveVal = (val: any): any => {
      if (typeof val === 'string' && val.startsWith('$')) {
        const varName = val.substring(1);
        return this.variables[varName] ?? val;
      }
      return val;
    };

    const targetSelector = getSelector(step.target);
    const value = resolveVal(step.value);

    const actionLower = step.action.toLowerCase();

    // --- Fully Dynamic Reflection API Dispatcher (100% Future-Proof) ---
    // Instead of hardcoding framework methods, we reflectively check if the action exists on CommonActions.
    // If it does, we dynamically parse its signature and perfectly map the JSON step arguments.
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(act));
    const exactMethod = methods.find(m => m.toLowerCase() === actionLower);

    if (exactMethod && typeof (act as any)[exactMethod] === 'function') {
      const fn = (act as any)[exactMethod];
      const fnStr = fn.toString();
      
      // Parse parameter names from the compiled JS function string
      const paramNamesMatch = fnStr.match(/^(?:async\s+)?(?:function\s*)?(?:[^\(]*)\(\s*([^)]*?)\s*\)/);
      const params = paramNamesMatch ? paramNamesMatch[1].split(',').map((p: string) => p.trim().split(/[ =:]/)[0]) : [];
      
      const argsToPass: any[] = [];
      for (const p of params) {
        if (!p) continue;
        if (p === 'selector' || p === 'target') argsToPass.push(targetSelector);
        else if (p === 'actionType' || p === 'type') argsToPass.push(step.actionType);
        else if (p === 'value' || p === 'text' || p === 'input') argsToPass.push(value);
        else if (p === 'options' || p === 'config') argsToPass.push(step.options);
        else argsToPass.push(undefined);
      }

      this.logger.info(`Dynamic Reflection Dispatcher invoking ${exactMethod}(${params.join(', ')})`);
      const res = await fn.apply(act, argsToPass);
      if (step.saveAs) this.variables[step.saveAs] = res;
      return;
    }

    // --- standard Action Mapping Delegated to Consolidated Methods ---
    switch (actionLower) {
      // --- Element & Mouse & Scroll Actions (Level 2 & Level 4) ---
      case 'navigate':
        await act.navigateTo(value);
        break;
      case 'click':
        await act.clickAction(targetSelector, 'click');
        break;
      case 'clickifvisible':
        await act.clickAction(targetSelector, 'conditional');
        break;
      case 'doubleclick':
        await act.clickAction(targetSelector, 'double');
        break;
      case 'rightclick':
        await act.clickAction(targetSelector, 'right');
        break;
      case 'hover':
        await act.mouseAction(targetSelector, 'hover');
        break;
      case 'draganddrop':
        await act.mouseAction(targetSelector, 'dragAndDrop', { target: getSelector(step.value) });
        break;
      case 'scroll':
        await act.scrollAction(targetSelector, 'intoView');
        break;
      case 'press':
        await act.press(targetSelector, value);
        break;

      // --- Smart Input Actions (Level 3) ---
      case 'fill':
      case 'entertext':
        await act.smartInput(targetSelector, 'clearAndEnter', value);
        break;
      case 'clear':
      case 'cleartext':
        await act.smartInput(targetSelector, 'clearUsingKeyboard', '');
        break;
      case 'typetext':
        await act.smartInput(targetSelector, 'typeSlowly', value);
        break;

      // --- Dropdown Actions (Level 5) ---
      case 'select':
      case 'selectvalue':
        await act.selectDropdown(targetSelector, 'byValue', value);
        break;
      case 'selecttext':
        await act.selectDropdown(targetSelector, 'byText', value);
        break;
      case 'selectmultiple':
        await act.selectDropdown(targetSelector, 'selectMultiple', value);
        break;
      case 'selectsearchable':
        await act.selectDropdown(targetSelector, 'searchAndSelect', value, {
          inputSelector: getSelector(step.value),
          searchText: step.promptText ?? ''
        });
        break;

      // --- Checkbox & Radio Actions (Level 6 & Level 7) ---
      case 'check':
      case 'selectcheckbox':
        await act.checkboxAction(targetSelector, 'check');
        break;
      case 'uncheck':
      case 'unselectcheckbox':
        await act.checkboxAction(targetSelector, 'uncheck');
        break;

      // --- Assertions & Validations (Level 14) ---
      case 'verifyvisible':
      case 'assertvisible':
        await act.validationAction(targetSelector, 'verifyVisible');
        break;
      case 'verifyhidden':
      case 'asserthidden':
        await act.validationAction(targetSelector, 'verifyHidden');
        break;
      case 'verifyenabled':
      case 'assertenabled':
        await act.validationAction(targetSelector, 'verifyEnabled');
        break;
      case 'verifydisabled':
      case 'assertdisabled':
        await act.validationAction(targetSelector, 'verifyDisabled');
        break;
      case 'verifyselected':
      case 'assertselected':
        await act.validationAction(targetSelector, 'verifyChecked');
        break;
      case 'verifycount':
      case 'assertcount':
        await act.validationAction(targetSelector, 'verifyCount', value);
        break;
      case 'verifyattribute':
      case 'assertattribute':
        await act.validationAction(targetSelector, 'verifyAttribute', value, { attributeName: step.attributeName });
        break;
      case 'verifytext':
      case 'asserttext':
        await act.validationAction(targetSelector, 'verifyText', value);
        break;
      case 'verifyvalue':
      case 'assertvalue':
        await act.validationAction(targetSelector, 'verifyValue', value);
        break;

      // --- Alerts & Dialog Actions (Level 12) ---
      case 'acceptalert':
        await act.alertAction(targetSelector, 'acceptAlert', { expectedText: value });
        break;
      case 'dismissalert':
        await act.alertAction(targetSelector, 'dismissAlert', { expectedText: value });
        break;
      case 'handleprompt':
        await act.alertAction(targetSelector, 'enterAlertText', { promptText: step.promptText, expectedText: value });
        break;

      // --- Frame Actions (Level 10) ---
      case 'switchtoframeandclick':
        await act.switchToFrameAndClick(step.frame ?? '', targetSelector);
        break;
      case 'switchtoframeandfill':
        await act.switchToFrameAndFill(step.frame ?? '', targetSelector, value);
        break;

      // --- File Actions (Level 15) ---
      case 'uploadfile':
        await act.fileAction(targetSelector, 'upload', { filePath: value });
        break;
      case 'downloadfile':
        const savePath = await act.fileAction(targetSelector, 'download', { downloadDir: value });
        if (step.saveAs) this.variables[step.saveAs] = savePath;
        break;

      // --- API Automation (Level 16) ---
      case 'api':
        const apiRes = await this.api!.apiAction(step.method?.toLowerCase() as any ?? 'get', step.url ?? '', {
          headers: step.headers,
          data: step.data,
          expectedStatus: step.expectedStatus,
          expectedText: step.expectedText
        });
        if (step.saveAs) {
          this.variables[step.saveAs] = apiRes;
        }
        break;

      // --- Database Actions (Level 17) ---
      case 'db':
      case 'querydb':
        const dbResult = DataEngine.dbAction('executeQuery', step.query, step.params);
        if (step.saveAs) this.variables[step.saveAs] = dbResult;
        break;

      // --- File Type Validations (Level 15) ---
      case 'validatepdf':
        DataEngine.fileAction('verifyFileExists', value);
        DataEngine.fileAction('readPdf', value);
        break;
      case 'validateexcel':
        DataEngine.fileAction('verifyFileExists', value);
        DataEngine.fileAction('readExcel', value);
        break;
      case 'validatezip':
        DataEngine.fileAction('verifyFileExists', value);
        DataEngine.fileAction('readZip', value);
        break;

      // --- Data Generation ---
      case 'generaterandomdata':
        let generatedData = '';
        if (step.type === 'email') generatedData = DataEngine.generateRandomEmail();
        else if (step.type === 'phone') generatedData = DataEngine.generateRandomPhone();
        else generatedData = DataEngine.generateRandomString();
        if (step.saveAs) this.variables[step.saveAs] = generatedData;
        this.logger.info(`Generated random ${step.type ?? 'string'}: ${generatedData}`);
        break;

      default:
        throw new Error(`Unsupported engine action: ${step.action}`);
    }
  }
}
