/**
 * ExecutionAgent – runs the generated Playwright spec file.
 * Captures stdout/stderr, screenshots, videos and logs.
 */
export declare class ExecutionAgent {
    private readonly logger;
    run(specPath: string): Promise<{
        passed: boolean;
        output: string;
    }>;
    private extractFailedSelector;
    private cleanExtractedSelector;
    private classifyFailure;
}
//# sourceMappingURL=ExecutionAgent.d.ts.map