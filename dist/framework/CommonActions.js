"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommonActions = void 0;
const test_1 = require("@playwright/test");
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
const FrameworkError_1 = require("./FrameworkError");
const HealingAgent_1 = require("../agents/healing/HealingAgent");
/**
 * Common UI actions with built‑in logging, error handling and auto‑screenshot.
 */
class CommonActions {
    constructor(page) {
        this.logger = logger_1.default.getInstance();
        this.page = page;
    }
    async clickElement(selector, options) {
        try {
            this.logger.info(`Clicking element ${selector}`);
            await this.waitForElementClickable(selector, options?.timeout);
            await this.page.locator(selector).click(this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('clickElement', selector, err);
        }
    }
    async click(selector, options) {
        await this.clickElement(selector, options);
    }
    async clickIfVisible(selector, options) {
        try {
            this.logger.info(`Clicking element if visible ${selector}`);
            const element = this.page.locator(selector).first();
            const timeout = options?.timeout ?? 3000;
            const isVisible = await element.isVisible({ timeout }).catch(() => false);
            if (!isVisible) {
                this.logger.info(`Optional element not visible, skipping ${selector}`);
                return;
            }
            await element.click(this.withTimeout({ ...options, timeout }));
        }
        catch (err) {
            await this.handleError('clickIfVisible', selector, err);
        }
    }
    async acceptAlert(selector, expectedText = '', options) {
        try {
            this.logger.info(`Accepting alert opened by ${selector}`);
            const actionOptions = this.withTimeout(options);
            const dialogPromise = this.handleNextDialog('accept', expectedText, actionOptions.timeout);
            await this.clickElement(selector, actionOptions);
            await dialogPromise;
        }
        catch (err) {
            await this.handleError('acceptAlert', selector, err);
        }
    }
    async dismissAlert(selector, expectedText = '', options) {
        try {
            this.logger.info(`Dismissing alert opened by ${selector}`);
            const actionOptions = this.withTimeout(options);
            const dialogPromise = this.handleNextDialog('dismiss', expectedText, actionOptions.timeout);
            await this.clickElement(selector, actionOptions);
            await dialogPromise;
        }
        catch (err) {
            await this.handleError('dismissAlert', selector, err);
        }
    }
    async enterText(selector, value, options) {
        try {
            this.logger.info(`Entering text in ${selector}`);
            const actionOptions = this.withTimeout(options);
            const element = this.page.locator(selector);
            await this.waitForElementVisible(selector, actionOptions.timeout);
            if (options?.clear !== false)
                await element.clear(actionOptions);
            await element.fill(value, actionOptions);
        }
        catch (err) {
            await this.handleError('enterText', selector, err);
        }
    }
    async clearText(selector, options) {
        try {
            this.logger.info(`Clearing text in ${selector}`);
            await this.waitForElementVisible(selector, options?.timeout);
            await this.page.locator(selector).clear(this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('clearText', selector, err);
        }
    }
    async fill(selector, value, options) {
        await this.enterText(selector, value, options);
    }
    async press(selector, key, options) {
        try {
            this.logger.info(`Pressing ${key} on ${selector}`);
            await this.page.press(selector, key, this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('press', selector, err);
        }
    }
    async pressKey(selector, key, options) {
        await this.press(selector, key, options);
    }
    async selectDropdownByValue(selector, value, options) {
        try {
            this.logger.info(`Selecting dropdown value ${value} on ${selector}`);
            await this.waitForElementVisible(selector, options?.timeout);
            await this.page.locator(selector).selectOption(value, this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('selectDropdownByValue', selector, err);
        }
    }
    async select(selector, value, options) {
        await this.selectDropdownByValue(selector, value, options);
    }
    async selectDropdownByText(selector, value, options) {
        try {
            this.logger.info(`Selecting dropdown text "${value}" from ${selector}`);
            const actionOptions = this.withTimeout(options);
            await this.waitForElementClickable(selector, actionOptions.timeout);
            await this.page.locator(selector).click(actionOptions);
            await this.page.getByRole('option', { name: value, exact: true }).click(actionOptions);
        }
        catch (err) {
            await this.handleError('selectDropdownByText', selector, err);
        }
    }
    async selectByText(selector, value, options) {
        await this.selectDropdownByText(selector, value, options);
    }
    async enterTextAndSelectOption(selector, value, options) {
        try {
            this.logger.info(`Entering text in ${selector} and selecting "${value}"`);
            const actionOptions = this.withTimeout(options);
            await this.waitForElementVisible(selector, actionOptions.timeout);
            const element = this.page.locator(selector);
            await element.fill(value, actionOptions);
            await this.page.getByRole('option', { name: new RegExp(value, 'i') }).first().click(actionOptions);
        }
        catch (err) {
            await this.handleError('enterTextAndSelectOption', selector, err);
        }
    }
    async fillAndChoose(selector, value, options) {
        await this.enterTextAndSelectOption(selector, value, options);
    }
    async selectCheckbox(selector, options) {
        try {
            this.logger.info(`Selecting checkbox ${selector}`);
            await this.waitForElementClickable(selector, options?.timeout);
            await this.page.locator(selector).check(this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('selectCheckbox', selector, err);
        }
    }
    async check(selector, options) {
        await this.selectCheckbox(selector, options);
    }
    async unselectCheckbox(selector, options) {
        try {
            this.logger.info(`Unselecting checkbox ${selector}`);
            await this.waitForElementClickable(selector, options?.timeout);
            await this.page.locator(selector).uncheck(this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('unselectCheckbox', selector, err);
        }
    }
    async uncheck(selector, options) {
        await this.unselectCheckbox(selector, options);
    }
    async hoverOverElement(selector, options) {
        try {
            this.logger.info(`Hovering over element ${selector}`);
            await this.waitForElementVisible(selector, options?.timeout);
            await this.page.locator(selector).hover(this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('hoverOverElement', selector, err);
        }
    }
    async hover(selector, options) {
        await this.hoverOverElement(selector, options);
    }
    async doubleClickElement(selector, options) {
        try {
            this.logger.info(`Double clicking element ${selector}`);
            await this.waitForElementClickable(selector, options?.timeout);
            await this.page.locator(selector).dblclick(this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('doubleClickElement', selector, err);
        }
    }
    async rightClickElement(selector, options) {
        try {
            this.logger.info(`Right clicking element ${selector}`);
            await this.waitForElementClickable(selector, options?.timeout);
            await this.page.locator(selector).click({ ...this.withTimeout(options), button: 'right' });
        }
        catch (err) {
            await this.handleError('rightClickElement', selector, err);
        }
    }
    async dragAndDrop(sourceSelector, targetSelector, options) {
        try {
            this.logger.info(`Dragging ${sourceSelector} to ${targetSelector}`);
            await this.page.locator(sourceSelector).dragTo(this.page.locator(targetSelector), this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('dragAndDrop', `${sourceSelector} -> ${targetSelector}`, err);
        }
    }
    async uploadFile(selector, filePath, options) {
        try {
            this.logger.info(`Uploading file on ${selector}`);
            await this.page.setInputFiles(selector, filePath, this.withTimeout(options));
        }
        catch (err) {
            await this.handleError('uploadFile', selector, err);
        }
    }
    async waitForElementVisible(selector, timeout = 10000) {
        try {
            await (0, test_1.expect)(this.page.locator(selector)).toBeVisible({ timeout });
        }
        catch (err) {
            await this.handleError('waitForElementVisible', selector, err);
        }
    }
    async waitForElementClickable(selector, timeout = 10000) {
        try {
            const element = this.page.locator(selector);
            await (0, test_1.expect)(element).toBeVisible({ timeout });
            await (0, test_1.expect)(element).toBeEnabled({ timeout });
        }
        catch (err) {
            await this.handleError('waitForElementClickable', selector, err);
        }
    }
    async waitForTextPresent(selector, value, timeout = 10000) {
        try {
            const matchingElement = this.page.locator(selector).filter({ hasText: value }).first();
            await (0, test_1.expect)(matchingElement).toContainText(value, { timeout });
        }
        catch (err) {
            await this.handleError('waitForTextPresent', selector, err);
        }
    }
    /** Resolve a selector at runtime.
     *  Attempts the original selector first. If it fails, falls back to a heuristic
     *  selector derived from the page DOM using HealingAgent logic. The returned
     *  selector is used only for this action; the original locator variable is
     *  never mutated, preserving user‑provided locators exactly.
     */
    async resolveLocator(original) {
        try {
            await this.page.waitForSelector(original, { timeout: 2000 });
            return original;
        }
        catch {
            // Grab page content and ask HealingAgent for a stable fallback
            const pageHtml = await this.page.content();
            const fallback = HealingAgent_1.HealingAgent.inferStableSelectorStatic(original, pageHtml);
            if (fallback) {
                this.logger.info('Locator fallback applied', { original, fallback });
                return fallback;
            }
            // No fallback found – continue with original selector and log warning
            this.logger.warn('HealingAgent could not infer a fallback, proceeding with original selector', { original });
            return original;
        }
    }
    async waitForAjaxComplete(timeout = 10000) {
        await this.page.waitForLoadState('networkidle', { timeout });
    }
    async verifyVisible(selector, timeout = 10000) {
        const sel = await this.resolveLocator(selector);
        await this.waitForElementVisible(sel, timeout);
    }
    async verifyEnabled(selector, timeout = 10000) {
        const sel = await this.resolveLocator(selector);
        await this.waitForElementClickable(sel, timeout);
    }
    async verifyHidden(selector, timeout = 10000) {
        const sel = await this.resolveLocator(selector);
        await (0, test_1.expect)(this.page.locator(sel)).toBeHidden({ timeout });
    }
    async verifyText(selector, value, timeout = 10000) {
        const sel = await this.resolveLocator(selector);
        await this.waitForTextPresent(sel, value, timeout);
    }
    async verifyValue(selector, value, timeout = 10000) {
        const sel = await this.resolveLocator(selector);
        await (0, test_1.expect)(this.page.locator(sel)).toHaveValue(value, { timeout });
    }
    async handleError(action, selector, err) {
        const timestamp = Date.now();
        const screenshotPath = `reports/screenshots/${action}-${timestamp}.png`;
        const domSnapshotPath = await this.captureDomSnapshot(action, timestamp);
        try {
            await (0, fs_extra_1.ensureDir)(path_1.default.dirname(screenshotPath));
            await this.page.screenshot({ path: screenshotPath, timeout: 3000 });
            this.logger.error(`${action} failed on ${selector}`, { error: err, screenshot: screenshotPath, domSnapshot: domSnapshotPath });
        }
        catch (screenshotErr) {
            this.logger.error(`${action} failed on ${selector}`, { error: err, screenshotError: screenshotErr, domSnapshot: domSnapshotPath });
        }
        throw new FrameworkError_1.FrameworkError(`${action} failed on ${selector}`, err);
    }
    async captureDomSnapshot(action, timestamp) {
        const snapshotPath = `reports/healing/dom-${action}-${timestamp}.html`;
        try {
            await (0, fs_extra_1.ensureDir)(path_1.default.dirname(snapshotPath));
            await (0, fs_extra_1.writeFile)(snapshotPath, await this.page.content());
            return snapshotPath;
        }
        catch (err) {
            this.logger.warn('DOM snapshot capture failed', { error: err });
            return undefined;
        }
    }
    handleNextDialog(mode, expectedText, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Dialog did not open within ${timeout}ms`));
            }, timeout);
            this.page.once('dialog', async (dialog) => {
                try {
                    clearTimeout(timer);
                    if (expectedText) {
                        (0, test_1.expect)(dialog.message()).toContain(expectedText);
                    }
                    if (mode === 'accept') {
                        await dialog.accept();
                    }
                    else {
                        await dialog.dismiss();
                    }
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });
        });
    }
    withTimeout(options) {
        return { timeout: 10000, ...(options ?? {}) };
    }
}
exports.CommonActions = CommonActions;
//# sourceMappingURL=CommonActions.js.map