"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecurityAgent = void 0;
const fs_1 = require("fs");
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../../utils/logger"));
const FrameworkError_1 = require("../../framework/FrameworkError");
/**
 * SecurityAgent validates generated artifacts before execution.
 * It keeps generated code framework-only: no AI provider calls, no shell/file IO,
 * and no low-level Playwright actions inside tests or page objects.
 */
class SecurityAgent {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.reportsDir = path_1.default.resolve('reports', 'security');
    }
    async run(targetPath = path_1.default.resolve('generated')) {
        try {
            const absoluteTarget = path_1.default.resolve(targetPath);
            const files = Array.from(new Set(await this.collectTypeScriptFiles(absoluteTarget)));
            const findings = files.flatMap((file) => this.scanFile(file));
            const criticalCount = findings.filter((finding) => finding.severity === 'critical').length;
            const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
            const reportPath = path_1.default.join(this.reportsDir, 'security-summary.json');
            await (0, fs_extra_1.ensureDir)(this.reportsDir);
            await (0, fs_extra_1.writeFile)(reportPath, JSON.stringify({
                generatedAt: new Date().toISOString(),
                targetPath: path_1.default.relative(process.cwd(), absoluteTarget),
                scannedFiles: files.map((file) => path_1.default.relative(process.cwd(), file)),
                passed: criticalCount === 0,
                criticalCount,
                warningCount,
                findings,
            }, null, 2));
            if (criticalCount > 0) {
                throw new FrameworkError_1.FrameworkError(`Security scan failed with ${criticalCount} critical finding(s)`, undefined, 'SECURITY_FAIL');
            }
            this.logger.info(`SecurityAgent: scanned ${files.length} file(s), ${warningCount} warning(s)`);
            return { passed: true, reportPath, findings };
        }
        catch (err) {
            if (err instanceof FrameworkError_1.FrameworkError) {
                this.logger.error(err.message);
                throw err;
            }
            this.logger.error('SecurityAgent failed', { error: err });
            throw new FrameworkError_1.FrameworkError('Security scan failed', err, 'SECURITY_FAIL');
        }
    }
    scanFile(file) {
        const relativeFile = path_1.default.relative(process.cwd(), file);
        const content = this.readTextFile(file);
        const findings = [];
        this.addPatternFinding(findings, content, relativeFile, 'critical', 'no-ai-runtime-in-generated', /LLMProvider|GROQ_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|groq\.com\/openai|anthropic\.com\/v1\/messages/i, 'Generated code must not call or configure AI providers.');
        this.addPatternFinding(findings, content, relativeFile, 'critical', 'no-shell-or-fs-in-generated', /from\s+['"](child_process|fs|fs-extra|node:fs|node:child_process)['"]|require\(['"](child_process|fs|fs-extra|node:fs|node:child_process)['"]\)/i, 'Generated code must not use shell or filesystem APIs.');
        this.addPatternFinding(findings, content, relativeFile, 'critical', 'no-dynamic-code-execution', /\beval\s*\(|new\s+Function\s*\(/, 'Generated code must not execute dynamic JavaScript.');
        this.addPatternFinding(findings, content, relativeFile, 'critical', 'no-secret-literals', /(api[_-]?key|access[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"]{8,}['"]/i, 'Generated code appears to contain a hard-coded secret.');
        this.addPatternFinding(findings, content, relativeFile, 'critical', 'no-focused-tests', /\b(?:test|describe)\.only\s*\(/, 'Generated tests must not contain focused .only blocks.');
        if (/generated[\\/](tests|pages)[\\/]/i.test(file)) {
            this.addPatternFinding(findings, content, relativeFile, 'critical', 'framework-actions-only', /\bpage\.(?:goto|click|fill|press|selectOption|check|uncheck|hover|dragAndDrop|setInputFiles)\s*\(/, 'Generated tests and page objects must use page-object methods and CommonActions, not low-level page actions.');
            this.addPatternFinding(findings, content, relativeFile, 'critical', 'no-direct-network-in-ui-code', /\b(?:fetch|axios\.\w+|http\.request|https\.request)\s*\(/, 'Generated UI tests and page objects must not make direct network calls; use ApiAgent for API setup.');
            this.addPatternFinding(findings, content, relativeFile, 'warning', 'avoid-generic-method-names', /\basync\s+(?:clickElement|clearAndClickElement|fillElement|clearElement|click[A-Z][A-Za-z0-9]*Element)\s*\(/, 'Generated methods should use user-friendly workflow names.');
            this.addPatternFinding(findings, content, relativeFile, 'warning', 'avoid-hard-waits', /\bwaitForTimeout\s*\(/, 'Generated UI code should wait for states or assertions instead of fixed sleeps.');
            this.addPatternFinding(findings, content, relativeFile, 'warning', 'avoid-skipped-tests', /\b(?:test|describe)\.skip\s*\(/, 'Generated tests should not silently skip coverage.');
        }
        if (/generated[\\/]locators[\\/]/i.test(file)) {
            this.addPatternFinding(findings, content, relativeFile, 'warning', 'avoid-fragile-locators', /nth-child|body\s*>\s*div|\/html\/body|\.css-[a-z0-9]+|\.jss\d+|\.sc-[a-z0-9]+/i, 'Locator file contains selectors that are likely fragile.');
        }
        return findings;
    }
    readTextFile(file) {
        try {
            return (0, fs_1.readFileSync)(file, 'utf-8');
        }
        catch {
            return '';
        }
    }
    addPatternFinding(findings, content, file, severity, ruleId, pattern, message) {
        if (!pattern.test(content))
            return;
        findings.push({ severity, ruleId, file, message });
    }
    async collectTypeScriptFiles(targetPath, visited = new Set()) {
        const info = await (0, fs_extra_1.stat)(targetPath);
        if (info.isFile()) {
            return targetPath.endsWith('.ts') ? this.collectGeneratedImportGraph(targetPath, visited) : [];
        }
        const entries = await (0, fs_extra_1.readdir)(targetPath);
        const files = [];
        for (const entry of entries) {
            const fullPath = path_1.default.join(targetPath, entry);
            const entryInfo = await (0, fs_extra_1.stat)(fullPath);
            if (entryInfo.isDirectory()) {
                files.push(...await this.collectTypeScriptFiles(fullPath));
            }
            else if (entry.endsWith('.ts')) {
                files.push(fullPath);
            }
        }
        return files;
    }
    async collectGeneratedImportGraph(file, visited) {
        const absoluteFile = path_1.default.resolve(file);
        if (visited.has(absoluteFile))
            return [];
        visited.add(absoluteFile);
        const files = [absoluteFile];
        const content = this.readTextFile(absoluteFile);
        const imports = Array.from(content.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g))
            .map((match) => match[1])
            .filter((importName) => !importName.includes('src/framework') && !importName.includes('src/utils'));
        for (const importName of imports) {
            const importedFile = await this.resolveRelativeImport(absoluteFile, importName);
            if (importedFile) {
                files.push(...await this.collectGeneratedImportGraph(importedFile, visited));
            }
        }
        return files;
    }
    async resolveRelativeImport(fromFile, importName) {
        const basePath = path_1.default.resolve(path_1.default.dirname(fromFile), importName);
        const candidates = [
            basePath,
            `${basePath}.ts`,
            path_1.default.join(basePath, 'index.ts'),
        ];
        for (const candidate of candidates) {
            if (await (0, fs_extra_1.pathExists)(candidate))
                return candidate;
        }
        return undefined;
    }
}
exports.SecurityAgent = SecurityAgent;
//# sourceMappingURL=SecurityAgent.js.map