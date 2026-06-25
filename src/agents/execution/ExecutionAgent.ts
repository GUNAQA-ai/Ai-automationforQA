import { spawn } from 'child_process';
import path from 'path';
import Logger from '../../utils/logger';
import { FrameworkError } from '../../framework/FrameworkError';
import { executionLog } from '../../utils/console-ui';

/**
 * ExecutionAgent – runs the generated Playwright spec file.
 * Captures stdout/stderr, screenshots, videos and logs.
 */
export class ExecutionAgent {
  private readonly logger = Logger.getInstance();

  async run(specPath: string): Promise<{ passed: boolean; output: string }> {
    const absolutePath = path.resolve(specPath);
    const relativePath = path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
    this.logger.info(`ExecutionAgent: running spec ${absolutePath}`);
    executionLog('info', 'Execution started', `Spec: ${relativePath}`);

    return new Promise((resolve, reject) => {
      const project = process.env.PLAYWRIGHT_PROJECT || 'chrome';
      let modeFlag = '';
      if (process.env.PLAYWRIGHT_UI === 'true') {
        modeFlag = ' --ui';
      } else if (process.env.HEADLESS !== 'true' && !process.env.CI) {
        modeFlag = ' --headed';
      }
      
      const cmd = `npx playwright test "${relativePath}" --project=${project}${modeFlag}`;
      executionLog('action', 'Opening browser', `Project: ${project}${modeFlag ? `, mode:${modeFlag.trim()}` : ''}`);

      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const configuredTimeout = Number(process.env.EXECUTION_TIMEOUT_MS ?? 80_000);
      const executionTimeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 80_000;

      const child = spawn(cmd, { cwd: process.cwd(), shell: true, env: process.env });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, executionTimeout);

      child.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        if (chunk.trim()) this.logger.info(chunk.trimEnd());
      });

      child.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        if (chunk.trim()) this.logger.warn(chunk.trimEnd());
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        const frameworkError = new FrameworkError('Execution process failed to start', error, 'EXEC_START_FAIL');
        executionLog('error', 'Execution failed', 'Playwright process could not start');
        reject(frameworkError);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0 || timedOut) {
          const output = `${stdout}\n${stderr}`;
          const failedSelector = this.extractFailedSelector(output);
          const failure = this.classifyFailure(output, failedSelector, timedOut);
          this.logger.error('Playwright execution failed', { exitCode: code, reason: failure.reason });
          if (failedSelector) {
            this.logger.warn(`ExecutionAgent: detected failed selector "${failedSelector}"`);
            executionLog('heal', 'Healing candidate detected', failedSelector);
          } else {
            executionLog('skip', 'Healing skipped', failure.reason);
          }

          const originalError = new Error(timedOut ? 'Playwright execution timed out' : `Playwright exited with code ${code}`);
          const frameworkError = new FrameworkError('Execution failed', originalError, 'EXEC_FAIL') as FrameworkError & {
            output?: string;
            failedSelector?: string;
            failureKind?: string;
            healingReason?: string;
          };
          frameworkError.output = output;
          frameworkError.failedSelector = failedSelector;
          frameworkError.failureKind = failure.kind;
          frameworkError.healingReason = failure.reason;
          reject(frameworkError);
        } else {
          this.logger.info('Playwright execution passed');
          executionLog('success', 'Execution passed', 'All browser steps completed');
          resolve({ passed: true, output: stdout });
        }
      });
    });
  }

  private extractFailedSelector(output: string): string | undefined {
    // 1. First try matching using a strict quoted string regex to handle nested parentheses and escaped quotes correctly
    const quotedLocatorLineMatch = output.match(/Locator:\s+locator\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
    if (quotedLocatorLineMatch?.[2]) return this.cleanExtractedSelector(quotedLocatorLineMatch[2]);

    const quotedWaitingForLocatorMatch = output.match(/waiting for locator\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
    if (quotedWaitingForLocatorMatch?.[2]) return this.cleanExtractedSelector(quotedWaitingForLocatorMatch[2]);

    const quotedLocatorMatch = output.match(/locator\(\s*(['"`])([\s\S]*?)\1\s*\)/i);
    if (quotedLocatorMatch?.[2]) return this.cleanExtractedSelector(quotedLocatorMatch[2]);

    // 2. Fallbacks to greedy or generic matches if the quoted pattern doesn't capture it
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
      return undefined;
    }

    return undefined;
  }

  private cleanExtractedSelector(selector: string): string {
    const trimmed = selector.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').split(/\s+\{"(?:error|screenshot|screenshotError)"/)[0].trim();
    const unwrapped = /^(['"`])[\s\S]*\1$/.test(trimmed)
      ? trimmed.slice(1, -1)
      : trimmed;

    return unwrapped
      .replace(/\\+(['"`])/g, '$1')
      .replace(/\\\\/g, '\\')
      .trim();
  }

  private classifyFailure(output: string, failedSelector: string | undefined, timedOut: boolean): { kind: string; reason: string } {
    if (failedSelector) {
      return { kind: 'locator', reason: `Locator failed: ${failedSelector}` };
    }

    if (timedOut) {
      return { kind: 'timeout', reason: 'Execution timed out before a failed selector was detected' };
    }

    if (/page\.goto:\s*url:\s*expected string,\s*got undefined/i.test(output)) {
      return {
        kind: 'navigation',
        reason: 'Navigation URL is missing; healing only fixes locators, not undefined applicationUrl values',
      };
    }

    if (/ReferenceError|TypeError: Duplicate declaration|No tests found/i.test(output)) {
      return {
        kind: 'code',
        reason: 'Generated test code failed before a locator action; healing only fixes locator failures',
      };
    }

    if (/SyntaxError/i.test(output) && /locator\(/i.test(output)) {
      return {
        kind: 'locator',
        reason: 'Invalid locator syntax detected; healing can update the selector',
      };
    }

    if (/browserType\.launch|Executable doesn't exist|Target page, context or browser has been closed/i.test(output)) {
      return {
        kind: 'browser',
        reason: 'Browser/runtime failed before a locator failure was detected',
      };
    }

    if (/expect\(|toBeVisible|toHaveText|toContainText|toBeEnabled/i.test(output)) {
      return {
        kind: 'assertion',
        reason: 'Assertion failed without a concrete selector value for healing',
      };
    }

    return {
      kind: 'unknown',
      reason: 'No failed selector was detected in Playwright output',
    };
  }
}
