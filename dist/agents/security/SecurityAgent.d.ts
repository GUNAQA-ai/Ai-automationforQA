type Severity = 'critical' | 'warning' | 'info';
interface SecurityFinding {
    severity: Severity;
    ruleId: string;
    file: string;
    message: string;
}
/**
 * SecurityAgent validates generated artifacts before execution.
 * It keeps generated code framework-only: no AI provider calls, no shell/file IO,
 * and no low-level Playwright actions inside tests or page objects.
 */
export declare class SecurityAgent {
    private readonly logger;
    private readonly reportsDir;
    run(targetPath?: string): Promise<{
        passed: boolean;
        reportPath: string;
        findings: SecurityFinding[];
    }>;
    private scanFile;
    private readTextFile;
    private addPatternFinding;
    private collectTypeScriptFiles;
    private collectGeneratedImportGraph;
    private resolveRelativeImport;
}
export {};
//# sourceMappingURL=SecurityAgent.d.ts.map