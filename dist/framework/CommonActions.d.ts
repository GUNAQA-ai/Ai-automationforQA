import { Page } from '@playwright/test';
/**
 * Common UI actions with built‑in logging, error handling and auto‑screenshot.
 */
export declare class CommonActions {
    private readonly page;
    private readonly logger;
    constructor(page: Page);
    clickElement(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    click(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    clickIfVisible(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    acceptAlert(selector: string, expectedText?: string, options?: {
        timeout?: number;
    }): Promise<void>;
    dismissAlert(selector: string, expectedText?: string, options?: {
        timeout?: number;
    }): Promise<void>;
    enterText(selector: string, value: string, options?: {
        timeout?: number;
        clear?: boolean;
    }): Promise<void>;
    clearText(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    fill(selector: string, value: string, options?: {
        timeout?: number;
    }): Promise<void>;
    press(selector: string, key: string, options?: {
        timeout?: number;
    }): Promise<void>;
    pressKey(selector: string, key: string, options?: {
        timeout?: number;
    }): Promise<void>;
    selectDropdownByValue(selector: string, value: string | string[], options?: {
        timeout?: number;
    }): Promise<void>;
    select(selector: string, value: string | string[], options?: {
        timeout?: number;
    }): Promise<void>;
    selectDropdownByText(selector: string, value: string, options?: {
        timeout?: number;
    }): Promise<void>;
    selectByText(selector: string, value: string, options?: {
        timeout?: number;
    }): Promise<void>;
    enterTextAndSelectOption(selector: string, value: string, options?: {
        timeout?: number;
    }): Promise<void>;
    fillAndChoose(selector: string, value: string, options?: {
        timeout?: number;
    }): Promise<void>;
    selectCheckbox(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    check(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    unselectCheckbox(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    uncheck(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    hoverOverElement(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    hover(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    doubleClickElement(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    rightClickElement(selector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    dragAndDrop(sourceSelector: string, targetSelector: string, options?: {
        timeout?: number;
    }): Promise<void>;
    uploadFile(selector: string, filePath: string | string[], options?: {
        timeout?: number;
    }): Promise<void>;
    waitForElementVisible(selector: string, timeout?: number): Promise<void>;
    waitForElementClickable(selector: string, timeout?: number): Promise<void>;
    waitForTextPresent(selector: string, value: string, timeout?: number): Promise<void>;
    /** Resolve a selector at runtime.
     *  Attempts the original selector first. If it fails, falls back to a heuristic
     *  selector derived from the page DOM using HealingAgent logic. The returned
     *  selector is used only for this action; the original locator variable is
     *  never mutated, preserving user‑provided locators exactly.
     */
    private resolveLocator;
    waitForAjaxComplete(timeout?: number): Promise<void>;
    verifyVisible(selector: string, timeout?: number): Promise<void>;
    verifyEnabled(selector: string, timeout?: number): Promise<void>;
    verifyHidden(selector: string, timeout?: number): Promise<void>;
    verifyText(selector: string, value: string, timeout?: number): Promise<void>;
    verifyValue(selector: string, value: string, timeout?: number): Promise<void>;
    private handleError;
    private captureDomSnapshot;
    private handleNextDialog;
    private withTimeout;
}
//# sourceMappingURL=CommonActions.d.ts.map