import { Page } from '@playwright/test';
import Logger from '../utils/logger';

/**
 * Advanced Synchronization Helpers for the AI-Playwright framework.
 * Implements auto-waits, explicit waits, network/load state waits, and retry logic.
 */
export class WaitHelpers {
  private static readonly logger = Logger.getInstance();

  /**
   * Retry an async function multiple times with exponential back‑off.
   * @param fn The async function to retry.
   * @param attempts Number of attempts (default 3).
   * @param delayMs Initial delay in ms (default 500).
   */
  static async retryAsync<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
    let attempt = 0;
    let lastError: any;
    while (attempt < attempts) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        attempt++;
        if (attempt < attempts) {
          const backoff = delayMs * Math.pow(2, attempt - 1);
          this.logger.warn(`Attempt ${attempt} failed. Retrying in ${backoff}ms...`, { error: err });
          await new Promise<void>(res => setTimeout(res, backoff));
        }
      }
    }
    this.logger.error(`All ${attempts} attempts failed.`, { error: lastError });
    throw lastError;
  }

  /**
   * Wait for a selector to reach a specific state.
   */
  static async waitForSelector(page: Page, selector: string, options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 10000;
    const state = options?.state ?? 'visible';
    this.logger.info(`Waiting for selector ${selector} to be ${state}`);
    await page.waitForSelector(selector, { state, timeout });
  }

  /**
   * Wait for all network requests to settle (network idle).
   */
  static async waitForNetworkIdle(page: Page, timeout = 10000): Promise<void> {
    this.logger.info(`Waiting for network idle state...`);
    await page.waitForLoadState('networkidle', { timeout });
  }

  /**
   * Wait for a specific page load state.
   */
  static async waitForLoadState(page: Page, state: 'load' | 'domcontentloaded' | 'networkidle' = 'load', timeout = 30000): Promise<void> {
    this.logger.info(`Waiting for page load state: ${state}`);
    await page.waitForLoadState(state, { timeout });
  }

  /**
   * Wait for a custom boolean condition to be true.
   */
  static async waitForCustomCondition(condition: () => Promise<boolean>, timeout = 10000, pollInterval = 500): Promise<void> {
    this.logger.info(`Waiting for custom condition to be satisfied...`);
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        if (await condition()) return;
      } catch (err) {
        // Suppress and continue polling
      }
      await new Promise<void>(resolve => setTimeout(resolve, pollInterval));
    }
    throw new Error(`Custom wait condition timed out after ${timeout}ms`);
  }

  /**
   * Combined Wait Action (Level 13) - Combines all wait variations into a single senior-level method.
   */
  static async waitAction(
    page: Page,
    action: 'visible' | 'hidden' | 'attached' | 'detached' | 'enabled' | 'disabled' | 'clickable' | 'editable' | 'stable' | 'networkidle' | 'api' | 'upload' | 'download' | 'spinner' | 'loader' | 'toast' | 'text' | 'url' | 'title',
    selectorOrValue?: string,
    options?: { timeout?: number; text?: string; url?: string; title?: string }
  ): Promise<void> {
    const timeout = options?.timeout ?? 10000;
    this.logger.info(`WaitHelpers: Executing wait action "${action}" on "${selectorOrValue ?? ''}"`);

    switch (action) {
      case 'visible':
        await page.waitForSelector(selectorOrValue!, { state: 'visible', timeout });
        break;
      case 'hidden':
        await page.waitForSelector(selectorOrValue!, { state: 'hidden', timeout });
        break;
      case 'attached':
        await page.waitForSelector(selectorOrValue!, { state: 'attached', timeout });
        break;
      case 'detached':
        await page.waitForSelector(selectorOrValue!, { state: 'detached', timeout });
        break;
      case 'enabled':
        await page.waitForFunction((sel) => {
          const el = document.querySelector(sel);
          return el && !(el as any).disabled;
        }, selectorOrValue!, { timeout });
        break;
      case 'disabled':
        await page.waitForFunction((sel) => {
          const el = document.querySelector(sel);
          return el && (el as any).disabled;
        }, selectorOrValue!, { timeout });
        break;
      case 'clickable':
      case 'editable':
        await page.waitForSelector(selectorOrValue!, { state: 'visible', timeout });
        await page.waitForFunction((sel) => {
          const el = document.querySelector(sel);
          return el && !(el as any).disabled;
        }, selectorOrValue!, { timeout });
        break;
      case 'stable':
        let lastBox: any = null;
        let isStable = false;
        const startTime = Date.now();
        while (Date.now() - startTime < timeout) {
          const el = page.locator(selectorOrValue!).first();
          if (await el.isVisible()) {
            const box = await el.boundingBox();
            if (lastBox && box && lastBox.x === box.x && lastBox.y === box.y && lastBox.width === box.width && lastBox.height === box.height) {
              isStable = true;
              break;
            }
            lastBox = box;
          }
          await new Promise(r => setTimeout(r, 100));
        }
        if (!isStable) throw new Error(`Element ${selectorOrValue} did not stabilize within ${timeout}ms`);
        break;
      case 'networkidle':
        await page.waitForLoadState('networkidle', { timeout });
        break;
      case 'api':
        await page.waitForLoadState('networkidle', { timeout });
        break;
      case 'upload':
      case 'download':
        await page.waitForTimeout(500);
        break;
      case 'spinner':
      case 'loader':
        const spinSelector = selectorOrValue ?? 'div.spinner, div.loader, .loading';
        await page.waitForSelector(spinSelector, { state: 'hidden', timeout });
        break;
      case 'toast':
        const toastSelector = selectorOrValue ?? '.toast, div.toast, .alert-toast';
        await page.waitForSelector(toastSelector, { state: 'visible', timeout });
        break;
      case 'text':
        const expectedText = options?.text ?? selectorOrValue;
        await page.waitForFunction(
          ({ sel, txt }) => {
            const el = document.querySelector(sel);
            return el && el.textContent?.includes(txt);
          },
          { sel: selectorOrValue!, txt: expectedText! },
          { timeout }
        );
        break;
      case 'url':
        const expectedUrl = options?.url ?? selectorOrValue;
        await page.waitForURL(expectedUrl!, { timeout });
        break;
      case 'title':
        const expectedTitle = options?.title ?? selectorOrValue;
        await page.waitForFunction((title) => document.title.includes(title), expectedTitle!, { timeout });
        break;
      default:
        throw new Error(`Unsupported wait action: ${action}`);
    }
  }
}
