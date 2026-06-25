export declare class WaitHelpers {
    /**
     * Retry an async function multiple times with exponential back‑off.
     * @param fn The async function to retry.
     * @param attempts Number of attempts (default 3).
     * @param delayMs Initial delay in ms (default 500).
     */
    static retryAsync<T>(fn: () => Promise<T>, attempts?: number, delayMs?: number): Promise<T>;
    /**
     * Simple explicit wait for a selector using Playwright's built‑in method.
     * Wrapped to provide unified logging.
     */
    static waitForSelector(page: any, selector: string, timeout?: number): Promise<void>;
}
//# sourceMappingURL=WaitHelpers.d.ts.map