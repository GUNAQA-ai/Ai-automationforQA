"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaitHelpers = void 0;
class WaitHelpers {
    /**
     * Retry an async function multiple times with exponential back‑off.
     * @param fn The async function to retry.
     * @param attempts Number of attempts (default 3).
     * @param delayMs Initial delay in ms (default 500).
     */
    static async retryAsync(fn, attempts = 3, delayMs = 500) {
        let attempt = 0;
        let lastError;
        while (attempt < attempts) {
            try {
                return await fn();
            }
            catch (err) {
                lastError = err;
                attempt++;
                if (attempt < attempts) {
                    const backoff = delayMs * Math.pow(2, attempt - 1);
                    await new Promise(res => setTimeout(res, backoff));
                }
            }
        }
        throw lastError;
    }
    /**
     * Simple explicit wait for a selector using Playwright's built‑in method.
     * Wrapped to provide unified logging.
     */
    static async waitForSelector(page, selector, timeout = 5000) {
        await page.waitForSelector(selector, { state: 'visible', timeout });
    }
}
exports.WaitHelpers = WaitHelpers;
//# sourceMappingURL=WaitHelpers.js.map