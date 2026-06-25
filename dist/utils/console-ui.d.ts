/**
 * Console UI utilities for readable AI-Playwright pipeline output.
 */
export declare function pipelineHeader(requestFile: string): void;
export declare function stageStart(stageNum: number, name: string, description: string): void;
export declare function stagePass(stageNum: number, name: string, detail: string): void;
export declare function stageFail(_stageNum: number, name: string, detail: string): void;
export declare function divider(): void;
export declare function banner(message: string, type?: 'info' | 'success' | 'error' | 'warn'): void;
export declare function executionLog(type: 'info' | 'action' | 'success' | 'warn' | 'error' | 'heal' | 'skip', title: string, detail?: string): void;
export declare function pipelineSummary(passed: boolean, elapsedSeconds: string): void;
//# sourceMappingURL=console-ui.d.ts.map