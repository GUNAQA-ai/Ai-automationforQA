#!/usr/bin/env node
/**
 * CLI Orchestrator - entry point for the AI-Playwright pipeline.
 *
 * Usage:
 *   npm run ai-test <request-file>.json          Run full pipeline
 *   npm run plan <request-file>.json             Run planning only
 *   npm run api <request-file>.json              Run API setup and validation
 *   npm run generate <plan-file>.json            Run generation only
 *   npm run security [generated-or-spec-path]    Run generated-code security scan
 *   npm run execute <spec-file>.spec.ts          Run execution with healing
 *   npm run heal <spec-file>.spec.ts <selector>  Run healing only
 *   npm run report                               Run reporting only
 */
import path from 'path';
import { pathExists, readFile, readdir, remove, stat, writeFile } from 'fs-extra';
import { Config } from './framework/Config';
import Logger from './utils/logger';
import { PlanningAgent } from './agents/planning/PlanningAgent';
import { GenerateAgent } from './agents/generate/GenerateAgent';
import { ApiAgent } from './agents/api/ApiAgent';
import { ExecutionAgent } from './agents/execution/ExecutionAgent';
import { HealingAgent } from './agents/healing/HealingAgent';
import { ReportingAgent } from './agents/reporting/ReportingAgent';
import { SecurityAgent } from './agents/security/SecurityAgent';
import { FrameworkError } from './framework/FrameworkError';
import { LLMProviderFactory } from './framework/LLMProvider';
import {
  banner,
  stageStart,
  stagePass,
  stageFail,
  pipelineHeader,
  pipelineSummary,
  executionLog,
} from './utils/console-ui';
import { FrameworkApiExtractor } from './utils/FrameworkApiExtractor';

async function resolveFile(arg: string, fallbackDir = 'requests'): Promise<string> {
  if (path.isAbsolute(arg)) return arg;
  const resolved = path.resolve(arg);
  if (await pathExists(resolved)) return resolved;
  return path.resolve(fallbackDir, arg);
}

async function findLatestGeneratedSpec(): Promise<string> {
  const testsDir = path.resolve('generated', 'tests');
  try {
    const entries = await readdir(testsDir);
    const specs = await Promise.all(entries
      .filter((entry) => entry.endsWith('.spec.ts'))
      .map(async (entry) => {
        const file = path.join(testsDir, entry);
        const info = await stat(file);
        return { file, mtimeMs: info.mtimeMs };
      }));

    const latest = specs.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
    return latest?.file ?? path.resolve('generated');
  } catch {
    return path.resolve('generated');
  }
}

async function runPlanning(requestFile: string): Promise<string> {
  stageStart(1, 'Planning Agent', 'Converting requirement to automation plan');
  const planner = new PlanningAgent();
  const planPath = await planner.run(requestFile);
  stagePass(1, 'Planning Agent', `Plan saved -> ${path.basename(planPath)}`);
  return planPath;
}

async function runGeneration(planPath: string, executionError?: string): Promise<string> {
  stageStart(3, 'Generation Agent', 'Generating Playwright code from plan');
  const generator = new GenerateAgent();
  const specPath = await generator.run(planPath, executionError);
  stagePass(3, 'Generation Agent', `Spec generated -> ${path.basename(specPath)}`);
  return specPath;
}

async function runApi(requestFile: string): Promise<string> {
  stageStart(2, 'API Agent', 'Executing API setup and validation from request JSON');
  const apiAgent = new ApiAgent();
  const reportPath = await apiAgent.run(requestFile);
  stagePass(2, 'API Agent', `API report -> ${path.relative(process.cwd(), reportPath)}`);
  return reportPath;
}

async function runSecurity(targetPath = 'generated'): Promise<string> {
  stageStart(4, 'Security Agent', 'Scanning generated code before execution');
  const securityAgent = new SecurityAgent();
  const result = await securityAgent.run(targetPath);
  stagePass(4, 'Security Agent', `Security report -> ${path.relative(process.cwd(), result.reportPath)}`);
  return result.reportPath;
}

async function runExecution(specPath: string): Promise<{ passed: boolean; output: string }> {
  stageStart(5, 'Execution Agent', 'Running Playwright tests in browser');
  const executor = new ExecutionAgent();
  const result = await executor.run(specPath);
  stagePass(5, 'Execution Agent', 'All tests passed');
  return result;
}

async function runHealing(specPath: string, failedSelector: string): Promise<string> {
  stageStart(6, 'Healing Agent', `Healing failed selector: "${failedSelector}"`);
  const healer = new HealingAgent();
  const healedSelector = await healer.run(specPath, failedSelector);
  stagePass(6, 'Healing Agent', `Healed -> "${healedSelector}"`);
  return healedSelector;
}

async function runExecutionWithHealing(planPath: string, specPath: string): Promise<void> {
  const logger = Logger.getInstance();
  const maxCodeHealingAttempts = 3;
  let codeHealingAttempts = 0;

  const configuredHealingAttempts = Number(process.env.HEALING_MAX_ATTEMPTS ?? 3);
  const maxLocatorHealingAttempts = Number.isFinite(configuredHealingAttempts) && configuredHealingAttempts > 0
    ? configuredHealingAttempts
    : 3;
  let locatorHealingAttempts = 0;
  let currentSpecPath = specPath;
  let lastError: any = null;

  while (true) {
    try {
      if (codeHealingAttempts === 0 && locatorHealingAttempts === 0) {
        await runExecution(currentSpecPath);
      } else {
        const attemptLabel = codeHealingAttempts > 0 
          ? `Code Fix ${codeHealingAttempts}/${maxCodeHealingAttempts}`
          : `Locator Heal ${locatorHealingAttempts}/${maxLocatorHealingAttempts}`;
        stageStart(6, 'Re-Execution', `Retrying after recovery (${attemptLabel})`);
        const executor = new ExecutionAgent();
        await executor.run(currentSpecPath);
        stagePass(6, 'Re-Execution', 'Tests passed after recovery');
      }
      return;
    } catch (execErr) {
      lastError = execErr;
      const failedSelector = (execErr as { failedSelector?: string }).failedSelector;
      const errorOutput = String((execErr as { output?: string })?.output ?? (execErr as Error)?.message ?? '');

      if (!failedSelector && codeHealingAttempts < maxCodeHealingAttempts) {
        codeHealingAttempts += 1;
        stageStart(3, 'Code Healing', `Execution failed with code error. Attempting codebase fix via GenerateAgent (${codeHealingAttempts}/${maxCodeHealingAttempts})...`);
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
          stageFail(6, 'Healing Agent', `Stopped after ${maxLocatorHealingAttempts} locator healing attempts. Last selector: "${failedSelector}"`);
          break;
        }

        locatorHealingAttempts += 1;
        executionLog('heal', 'Execution paused for locator healing', failedSelector);
        await runHealing(currentSpecPath, failedSelector);
        executionLog('heal', 'Healing complete; re-running same spec', path.relative(process.cwd(), currentSpecPath));
        continue;
      }

      break;
    }
  }

  throw lastError;
}

async function runReporting(): Promise<void> {
  stageStart(7, 'Reporting Agent', 'Aggregating reports, screenshots and videos');
  const reporter = new ReportingAgent();
  await reporter.run();
  stagePass(7, 'Reporting Agent', 'Reports ready in reports/ directory');
}

async function readPreconditionPlanPaths(planPath: string): Promise<string[]> {
  try {
    const raw = await readFile(planPath, 'utf-8');
    const plan = JSON.parse(raw);
    const references = [
      ...extractPlanPathReferences(plan.preconditions),
      ...extractPlanPathReferences(plan.preConditions),
      ...extractPlanPathReferences(plan.executionOrder),
    ];

    const unique = new Set<string>();
    for (const reference of references) {
      const resolved = await resolveReferencedPlanPath(reference, planPath);
      if (resolved && path.resolve(resolved) !== path.resolve(planPath)) {
        unique.add(path.resolve(resolved));
      }
    }

    return Array.from(unique);
  } catch {
    return [];
  }
}

async function readPlan(planPath: string): Promise<Record<string, any>> {
  const raw = await readFile(planPath, 'utf-8');
  const plan = JSON.parse(raw);
  return plan && typeof plan === 'object' ? plan : {};
}

function extractPlanPathReferences(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    const planPath = record.planPath ?? record.path ?? record.file;
    return typeof planPath === 'string' ? [planPath] : [];
  });
}

async function resolveReferencedPlanPath(reference: string, fromPlanPath: string): Promise<string | undefined> {
  if (!reference.trim()) return undefined;
  if (path.isAbsolute(reference)) return reference;

  const cwdCandidate = path.resolve(reference);
  if (await pathExists(cwdCandidate)) return cwdCandidate;

  const siblingCandidate = path.resolve(path.dirname(fromPlanPath), reference);
  if (await pathExists(siblingCandidate)) return siblingCandidate;

  return cwdCandidate;
}

async function runPlanWithPreconditions(planPath: string, executedPlans: Set<string>): Promise<void> {
  const absolutePlanPath = path.resolve(planPath);
  if (executedPlans.has(absolutePlanPath)) {
    executionLog('skip', 'Precondition already executed', path.relative(process.cwd(), absolutePlanPath));
    return;
  }
  executedPlans.add(absolutePlanPath);

  const plan = await readPlan(absolutePlanPath);
  const preconditionPlanPaths = await readPreconditionPlanPaths(absolutePlanPath);
  for (const preconditionPlanPath of preconditionPlanPaths) {
    executionLog('info', 'Running precondition plan', path.relative(process.cwd(), preconditionPlanPath));
    await runPlanWithPreconditions(preconditionPlanPath, executedPlans);
  }

  if (shouldSkipPlanExecution(plan)) {
    executionLog('skip', 'Suite/controller plan completed', path.relative(process.cwd(), absolutePlanPath));
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
      executionLog('heal', 'Plan updated with missing setup recovery', path.relative(process.cwd(), absolutePlanPath));
    }
  }
}

function shouldSkipPlanExecution(plan: Record<string, any>): boolean {
  return Boolean(plan.suite || plan.skipExecution || plan.controller)
    || (!Array.isArray(plan.steps) || plan.steps.length === 0);
}

async function tryApplyPlanRecovery(planPath: string, err: unknown): Promise<boolean> {
  if (process.env.PLAN_RECOVERY === 'false') return false;

  const plan = await readPlan(planPath);
  if (shouldSkipPlanExecution(plan)) return false;

  const recoverySteps = await inferRecoverySteps(plan, err);
  if (!recoverySteps.length) return false;

  const existingSteps = Array.isArray(plan.steps) ? plan.steps : [];
  const uniqueRecoverySteps = recoverySteps.filter((step) => !hasEquivalentStep(existingSteps, step));
  if (!uniqueRecoverySteps.length) return false;

  const insertIndex = existingSteps.findIndex((step, index) => {
    if (index === 0 && String(step?.action ?? '').toLowerCase() === 'navigate') return false;
    return true;
  });
  const safeInsertIndex = insertIndex === -1 ? existingSteps.length : insertIndex;
  const nextSteps = [
    ...existingSteps.slice(0, safeInsertIndex),
    ...uniqueRecoverySteps,
    ...existingSteps.slice(safeInsertIndex),
  ].map((step, index) => ({ ...step, step: index + 1 }));

  const nextPlan = {
    ...plan,
    steps: nextSteps,
    setupSteps: [
      ...(Array.isArray(plan.setupSteps) ? plan.setupSteps : []),
      ...uniqueRecoverySteps,
    ],
    recoveryHistory: [
      ...(Array.isArray(plan.recoveryHistory) ? plan.recoveryHistory : []),
      {
        recoveredAt: new Date().toISOString(),
        reason: recoveryReason(err),
        steps: uniqueRecoverySteps,
      },
    ],
  };

  await writeFile(planPath, JSON.stringify(nextPlan, null, 2));
  return true;
}

async function inferRecoverySteps(plan: Record<string, any>, err: unknown): Promise<any[]> {
  const output = String((err as { output?: string })?.output ?? '');
  const failedSelector = String((err as { failedSelector?: string })?.failedSelector ?? '');
  const reason = String((err as { healingReason?: string })?.healingReason ?? '');
  const message = String((err as Error)?.message ?? '');
  const combinedFailure = `Error Message: ${message}\nFailed Selector: ${failedSelector}\nHealing Reason: ${reason}\nPlaywright Logs:\n${output}`.trim();

  // If AI is enabled, use LLM reasoning to infer the required recovery steps dynamically
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
      const cleaned = responseText.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) {
          Logger.getInstance().info(`CLI: Dynamic LLM reasoning suggested ${parsed.length} plan recovery steps`);
          return parsed;
        }
      }
    } catch (llmErr) {
      Logger.getInstance().warn(`CLI: LLM plan recovery reasoning failed: ${llmErr}. Falling back to rule-based recovery.`);
    }
  }

  // Fallback to rules-based recovery if AI is disabled or fails
  const steps: any[] = [];
  const combined = `${output}\n${failedSelector}\n${reason}\n${message}`.toLowerCase();
  const locators = plan.locators && typeof plan.locators === 'object' ? plan.locators as Record<string, unknown> : {};

  // 1. Dynamic Popup/Modal dismiss fallback
  if (/intercepts pointer events|modal|dialog|popup|overlay|blocked|not receiving pointer/i.test(combined)) {
    const closeKey = Object.keys(locators).find(key => 
      /close|dismiss|skip|cancel|hide/i.test(key)
    );
    if (closeKey) {
      steps.push({
        action: 'clickIfVisible',
        target: closeKey,
        optional: true,
        recovered: true,
        expectedResult: 'Blocking dialog or popup is closed'
      });
    }
  }

  // 2. Dynamic Missing Input fill fallback
  if (/disabled|validation|required|invalid/i.test(combined)) {
    const testData = plan.testData && typeof plan.testData === 'object' ? plan.testData as Record<string, unknown> : {};
    Object.keys(locators).forEach(key => {
      const isField = /field|input|text|email|pass/i.test(key);
      const hasValue = testData[key] !== undefined;
      const stepExists = Array.isArray(plan.steps) && plan.steps.some(s => String(s?.target).toLowerCase() === key.toLowerCase());
      if (isField && hasValue && !stepExists) {
        steps.push({
          action: 'fill',
          target: key,
          value: String(testData[key]),
          recovered: true,
          expectedResult: `Field ${key} is filled`
        });
      }
    });
  }

  // 3. Dynamic Navigation click fallback
  if (/timeout|waiting for|not visible|locator failed/i.test(combined)) {
    const targetKey = Object.keys(locators).find(key => {
      const isMenu = /menu|link|tab|nav|button/i.test(key);
      const stepExists = Array.isArray(plan.steps) && plan.steps.some(s => String(s?.target).toLowerCase() === key.toLowerCase());
      return isMenu && !stepExists;
    });
    if (targetKey) {
      steps.push({
        action: 'click',
        target: targetKey,
        recovered: true,
        expectedResult: `Navigate to target using ${targetKey}`
      });
    }
  }

  return steps;
}

function findLocatorKey(locatorsInput: unknown, candidates: string[], pattern?: RegExp): string | undefined {
  if (!locatorsInput || typeof locatorsInput !== 'object') return undefined;
  const locators = locatorsInput as Record<string, unknown>;
  const normalizedCandidates = new Set(candidates.map(normalizeKey));
  const direct = Object.keys(locators).find((key) => normalizedCandidates.has(normalizeKey(key)));
  if (direct) return direct;
  if (!pattern) return undefined;
  return Object.entries(locators).find(([key, value]) => pattern.test(`${key} ${String(value)}`))?.[0];
}

function hasEquivalentStep(steps: any[], candidate: { action: string; target: string }): boolean {
  const candidateAction = normalizeKey(candidate.action);
  const candidateTarget = normalizeKey(candidate.target);
  return steps.some((step) => normalizeKey(String(step?.action ?? '')) === candidateAction && normalizeKey(String(step?.target ?? '')) === candidateTarget);
}

function recoveryReason(err: unknown): string {
  return String((err as { healingReason?: string })?.healingReason ?? (err as Error)?.message ?? 'Execution failure');
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function runFullPipeline(requestFile: string): Promise<void> {
  const startTime = Date.now();
  pipelineHeader(requestFile);
  Config.get();
  
  Logger.getInstance().info('Initializing Dynamic Framework Capabilities...');
  const apiDocs = await FrameworkApiExtractor.extractApiDocs();
  const capabilityCount = apiDocs.split('\n').filter(line => line.includes('- `')).length;
  Logger.getInstance().info(`Successfully extracted ${capabilityCount} dynamic framework actions from CommonActions.ts`);

  const planPath = await runPlanning(requestFile);
  await runApi(requestFile);

  let executionError: unknown;
  try {
    await runPlanWithPreconditions(planPath, new Set<string>());
  } catch (execErr) {
    executionError = execErr;
  }

  await runReporting();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  pipelineSummary(!executionError, elapsed);

  if (executionError) {
    throw executionError;
  }
}

async function predetectEnvironment(args: string[], stage: string): Promise<void> {
  try {
    let fileToRead = '';
    if (args[0] && args[0].endsWith('.json')) {
      fileToRead = await resolveFile(args[0], stage === 'generate' || stage === 'execute' ? 'storage/plans' : 'requests');
    }
    if (fileToRead && (await pathExists(fileToRead))) {
      const raw = await readFile(fileToRead, 'utf-8');
      const parsed = JSON.parse(raw);
      const envName = parsed.environment ?? parsed.env;
      if (typeof envName === 'string' && envName.trim()) {
        process.env.ENVIRONMENT = envName.trim();
      }
    }
  } catch {
    // Ignore pre-detection failures
  }
}

async function getFilesFromTarget(targetPath: string, extensions: string[], fallbackDir = 'requests'): Promise<string[]> {
  const resolved = await resolveFile(targetPath, fallbackDir);
  if (!(await pathExists(resolved))) {
    throw new Error(`Path does not exist: ${targetPath}`);
  }
  const info = await stat(resolved);
  if (info.isDirectory()) {
    const entries = await readdir(resolved);
    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(resolved, entry);
      const entryStat = await stat(fullPath);
      if (entryStat.isFile() && extensions.some(ext => entry.endsWith(ext))) {
        files.push(fullPath);
      }
    }
    return files.sort();
  }
  return [resolved];
}

(async () => {
  const logger = Logger.getInstance();
  let stage = process.env.AI_STAGE || 'full';
  let args = process.argv.slice(2);

  // Parse subcommand if present
  if (args[0]) {
    const candidate = args[0].toLowerCase();
    const subcommands = ['all', 'plan', 'generate', 'execute', 'api', 'security', 'heal', 'report'];
    if (subcommands.includes(candidate)) {
      stage = candidate === 'all' ? 'full' : candidate;
      args = args.slice(1);
    }
  }

  try {
    await predetectEnvironment(args, stage);
    Config.get();

    switch (stage) {
      case 'plan': {
        if (!args[0]) { banner('Usage: npm run plan <request-file-or-folder>', 'error'); process.exit(1); }
        const files = await getFilesFromTarget(args[0], ['.json'], 'requests');
        try {
          const plansDir = path.resolve('storage', 'plans');
          if (await pathExists(plansDir)) {
            await remove(plansDir);
          }
          const indexFile = path.resolve('generated', '.artifact-index.json');
          if (await pathExists(indexFile)) {
            await remove(indexFile);
          }
        } catch {}
        for (const file of files) {
          const planPath = await runPlanning(file);
          banner(`\n  Plan output: ${planPath}\n`, 'success');
        }
        break;
      }
      case 'generate': {
        if (!args[0]) { banner('Usage: npm run generate <plan-file-or-folder>', 'error'); process.exit(1); }
        const files = await getFilesFromTarget(args[0], ['.json'], 'storage/plans');
        for (const file of files) {
          const specPath = await runGeneration(file);
          banner(`\n  Spec output: ${specPath}\n`, 'success');
        }
        break;
      }
      case 'api': {
        if (!args[0]) { banner('Usage: npm run api <request-file-or-folder>', 'error'); process.exit(1); }
        const files = await getFilesFromTarget(args[0], ['.json'], 'requests');
        for (const file of files) {
          const reportPath = await runApi(file);
          banner(`\n  API report: ${reportPath}\n`, 'success');
        }
        break;
      }
      case 'security': {
        const targetPath = args[0] ? await resolveFile(args[0], 'generated/tests') : await findLatestGeneratedSpec();
        const reportPath = await runSecurity(targetPath);
        banner(`\n  Security report: ${reportPath}\n`, 'success');
        break;
      }
      case 'execute': {
        if (!args[0]) { banner('Usage: npm run execute <spec-file-or-folder>', 'error'); process.exit(1); }
        const files = await getFilesFromTarget(args[0], ['.spec.ts', '.ts'], 'generated/tests');
        for (const file of files) {
          const specBase = path.basename(file, '.spec.ts');
          const planCandidates = [
            path.resolve('storage', 'plans', `${specBase}Plan.json`),
            path.resolve('storage', 'plans', `${specBase}_2Plan.json`),
            path.resolve('storage', 'plans', `${specBase}.json`)
          ];
          let planFile = '';
          for (const candidate of planCandidates) {
            if (await pathExists(candidate)) {
              planFile = candidate;
              break;
            }
          }
          await runExecutionWithHealing(planFile, file);
        }
        break;
      }
      case 'heal': {
        if (!args[0] || !args[1]) { banner('Usage: npm run heal <spec-file>.spec.ts <failed-selector>', 'error'); process.exit(1); }
        const specFile = await resolveFile(args[0], 'generated/tests');
        await runHealing(specFile, args[1]);
        break;
      }
      case 'report': {
        await runReporting();
        break;
      }
      case 'full':
      default: {
        if (!args[0]) { banner('Usage: npm run ai-test <request-file-or-folder>', 'error'); process.exit(1); }
        const files = await getFilesFromTarget(args[0], ['.json'], 'requests');
        try {
          const plansDir = path.resolve('storage', 'plans');
          if (await pathExists(plansDir)) {
            await remove(plansDir);
          }
          const indexFile = path.resolve('generated', '.artifact-index.json');
          if (await pathExists(indexFile)) {
            await remove(indexFile);
          }
        } catch {}
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
      logger.error(`Unexpected error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
})();
