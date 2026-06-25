"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BasePage = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
/**
 * Abstract base class for all generated page objects.
 * Provides common navigation and page‑load helpers.
 */
class BasePage {
    constructor(page) {
        this.logger = logger_1.default.getInstance();
        this.page = page;
    }
    /**
     * Navigate to a given URL and wait for the load event.
     * @param url Target URL
     */
    async navigateTo(url) {
        try {
            this.logger.info(`Navigating to ${url}`);
            await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        catch (err) {
            this.logger.error('Navigation failed', { url, error: err });
            throw err;
        }
    }
    /**
     * Wait for a selector to become visible.
     * @param selector CSS/XPath selector
     */
    async waitForVisible(selector, timeout = 3000) {
        try {
            await this.page.waitForSelector(selector, { state: 'visible', timeout });
        }
        catch (err) {
            this.logger.error('Element not visible', { selector, error: err });
            throw err;
        }
    }
}
exports.BasePage = BasePage;
//# sourceMappingURL=BasePage.js.map