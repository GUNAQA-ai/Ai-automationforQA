import { Page } from '@playwright/test';
import Logger from '../utils/logger';
/**
 * Abstract base class for all generated page objects.
 * Provides common navigation and page‑load helpers.
 */
export declare abstract class BasePage {
    protected readonly page: Page;
    protected readonly logger: Logger;
    constructor(page: Page);
    /**
     * Navigate to a given URL and wait for the load event.
     * @param url Target URL
     */
    navigateTo(url: string): Promise<void>;
    /**
     * Wait for a selector to become visible.
     * @param selector CSS/XPath selector
     */
    waitForVisible(selector: string, timeout?: number): Promise<void>;
}
//# sourceMappingURL=BasePage.d.ts.map