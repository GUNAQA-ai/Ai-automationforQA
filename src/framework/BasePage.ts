import { Page, Frame, expect } from '@playwright/test';
import Logger from '../utils/logger';

/**
 * BasePage - The core of the Page Object Model (POM) in the framework.
 * Provides general browser navigation, title/URL assertions, frame handling, 
 * multiple tab/window switching, and dialog handlers.
 */
export class BasePage {
  protected readonly page: Page;
  protected readonly logger = Logger.getInstance();

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Return the active Playwright Page instance.
   */
  getPage(): Page {
    return this.page;
  }

  /**
   * Navigate to a URL and wait for page load.
   */
  async navigateTo(url: string, timeout = 30000): Promise<void> {
    try {
      this.logger.info(`Navigating to: ${url}`);
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    } catch (err) {
      this.logger.error(`POM: Navigation failed to ${url}`, { error: err });
      throw err;
    }
  }

  /**
   * Navigate back in browser history.
   */
  async back(): Promise<void> {
    this.logger.info('Navigating back');
    await this.page.goBack({ waitUntil: 'domcontentloaded' });
  }

  /**
   * Navigate forward in browser history.
   */
  async forward(): Promise<void> {
    this.logger.info('Navigating forward');
    await this.page.goForward({ waitUntil: 'domcontentloaded' });
  }

  /**
   * Refresh the active page.
   */
  async refresh(): Promise<void> {
    this.logger.info('Refreshing page');
    await this.page.reload({ waitUntil: 'domcontentloaded' });
  }

  /**
   * Verify the current page URL.
   */
  async verifyUrl(expectedUrl: string | RegExp, timeout = 5000): Promise<void> {
    this.logger.info(`Verifying page URL matches: ${expectedUrl}`);
    await expect(this.page).toHaveURL(expectedUrl, { timeout });
  }

  /**
   * Verify the current page title.
   */
  async verifyTitle(expectedTitle: string | RegExp, timeout = 5000): Promise<void> {
    this.logger.info(`Verifying page title matches: ${expectedTitle}`);
    await expect(this.page).toHaveTitle(expectedTitle, { timeout });
  }

  /**
   * Get an iframe by selector.
   */
  getFrame(frameSelector: string): Frame | null {
    this.logger.info(`Locating iframe with selector: ${frameSelector}`);
    const iframeElement = this.page.frame({ url: new RegExp(frameSelector) }) 
      ?? this.page.frames().find(f => f.name() === frameSelector);
    return iframeElement || null;
  }

  /**
   * Wait for a new tab or window to open and return its Page instance.
   */
  async waitForNewTab(action: () => Promise<void>, timeout = 10000): Promise<Page> {
    this.logger.info('Waiting for a new tab/window to open...');
    const [newTab] = await Promise.all([
      this.page.context().waitForEvent('page', { timeout }),
      action()
    ]);
    await newTab.waitForLoadState('domcontentloaded');
    return newTab;
  }

  /**
   * Combined Browser Context Action (Level 1)
   */
  async browserContextAction(
    action: 'newContext' | 'closeContext' | 'clearContext' | 'setViewport' | 'setPermissions' | 'setGeolocation',
    options?: {
      viewport?: { width: number; height: number };
      permissions?: string[];
      geolocation?: { latitude: number; longitude: number; accuracy?: number };
    }
  ): Promise<any> {
    const ctx = this.page.context();
    this.logger.info(`BasePage: Executing browser context action "${action}"`);

    switch (action) {
      case 'closeContext':
        await ctx.close();
        break;
      case 'clearContext':
        await ctx.clearCookies();
        await ctx.clearPermissions();
        break;
      case 'setViewport':
        if (options?.viewport) {
          await this.page.setViewportSize(options.viewport);
        }
        break;
      case 'setPermissions':
        if (options?.permissions) {
          await ctx.grantPermissions(options.permissions);
        }
        break;
      case 'setGeolocation':
        if (options?.geolocation) {
          await ctx.setGeolocation(options.geolocation);
        }
        break;
      default:
        throw new Error(`Unsupported browser context action: ${action}`);
    }
  }

  /**
   * Combined Window/Tab Action (Level 11 & Level 1)
   */
  async windowAction(
    action: 'openTab' | 'closeTab' | 'switchTab' | 'switchWindow' | 'closeWindow' | 'switchParent' | 'getWindowCount' | 'verifyNewWindow',
    options?: {
      url?: string;
      tabIndex?: number;
      windowIndex?: number;
      pageInstance?: Page;
    }
  ): Promise<any> {
    this.logger.info(`BasePage: Executing window action "${action}"`);
    const context = this.page.context();

    switch (action) {
      case 'openTab':
        const newPage = await context.newPage();
        if (options?.url) {
          await newPage.goto(options.url, { waitUntil: 'domcontentloaded' });
        }
        return newPage;
      case 'closeTab':
      case 'closeWindow':
        const targetPage = options?.pageInstance ?? this.page;
        await targetPage.close();
        break;
      case 'switchTab':
      case 'switchWindow':
        const pages = context.pages();
        const index = options?.tabIndex ?? options?.windowIndex ?? 0;
        if (index < pages.length) {
          return pages[index];
        }
        throw new Error(`Window index ${index} out of bounds`);
      case 'switchParent':
        return context.pages()[0];
      case 'getWindowCount':
        return context.pages().length;
      case 'verifyNewWindow':
        await expect(context.pages().length).toBeGreaterThan(1);
        break;
      default:
        throw new Error(`Unsupported window action: ${action}`);
    }
  }

  /**
   * Combined Frame Action (Level 10)
   */
  async frameAction(
    action: 'switchFrame' | 'switchNestedFrame' | 'switchParentFrame' | 'exitFrame' | 'findFrame' | 'waitForFrame' | 'executeInside',
    selectorOrName?: string,
    options?: {
      fn?: (frame: Frame) => Promise<any>;
      timeout?: number;
    }
  ): Promise<any> {
    this.logger.info(`BasePage: Executing frame action "${action}" on "${selectorOrName ?? ''}"`);

    const resolveFrame = (): Frame => {
      const frame = this.getFrame(selectorOrName!);
      if (!frame) throw new Error(`Frame not found matching: ${selectorOrName}`);
      return frame;
    };

    switch (action) {
      case 'switchFrame':
      case 'findFrame':
        return resolveFrame();
      case 'switchParentFrame':
      case 'exitFrame':
        return this.page;
      case 'waitForFrame':
        const timeout = options?.timeout ?? 10000;
        await this.page.waitForSelector(selectorOrName!, { state: 'attached', timeout });
        return resolveFrame();
      case 'executeInside':
        const frame = resolveFrame();
        if (options?.fn) {
          return await options.fn(frame);
        }
        break;
      default:
        throw new Error(`Unsupported frame action: ${action}`);
    }
  }
}
