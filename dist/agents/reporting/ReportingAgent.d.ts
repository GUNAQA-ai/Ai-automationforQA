/**
 * ReportingAgent refreshes report folders and writes a single summary JSON.
 */
export declare class ReportingAgent {
    private readonly logger;
    private readonly reportsDir;
    run(): Promise<void>;
    private resetReportFolder;
    private copyIfPresent;
    private optionalReportPath;
}
//# sourceMappingURL=ReportingAgent.d.ts.map