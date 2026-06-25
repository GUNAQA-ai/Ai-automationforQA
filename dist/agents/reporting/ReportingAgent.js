"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReportingAgent = void 0;
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../../utils/logger"));
const FrameworkError_1 = require("../../framework/FrameworkError");
/**
 * ReportingAgent refreshes report folders and writes a single summary JSON.
 */
class ReportingAgent {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.reportsDir = path_1.default.resolve('reports');
    }
    async run() {
        try {
            await (0, fs_extra_1.ensureDir)(this.reportsDir);
            await this.resetReportFolder('html');
            await this.resetReportFolder('allure-report');
            await this.resetReportFolder('allure-results');
            await this.resetReportFolder('test-results');
            await (0, fs_extra_1.ensureDir)(path_1.default.join(this.reportsDir, 'screenshots'));
            await (0, fs_extra_1.ensureDir)(path_1.default.join(this.reportsDir, 'videos'));
            await (0, fs_extra_1.ensureDir)(path_1.default.join(this.reportsDir, 'logs'));
            await this.copyIfPresent('playwright-report', 'html', 'HTML report');
            await this.copyIfPresent('allure-report', 'allure-report', 'Allure report');
            await this.copyIfPresent('allure-results', 'allure-results', 'Allure results');
            await this.copyIfPresent('test-results', 'test-results', 'Playwright test results');
            const summary = {
                generatedAt: new Date().toISOString(),
                htmlReport: 'reports/html/index.html',
                allureReport: 'reports/allure-report/index.html',
                allureResults: 'reports/allure-results',
                testResults: 'reports/test-results',
                apiReport: await this.optionalReportPath('api/api-summary.json'),
                securityReport: await this.optionalReportPath('security/security-summary.json'),
            };
            await (0, fs_extra_1.writeFile)(path_1.default.join(this.reportsDir, 'summary.json'), JSON.stringify(summary, null, 2));
            this.logger.info('Report summary written to reports/summary.json');
        }
        catch (err) {
            this.logger.error('ReportingAgent failed', { error: err });
            throw new FrameworkError_1.FrameworkError('Reporting failed', err, 'REPORT_FAIL');
        }
    }
    async resetReportFolder(folderName) {
        const folderPath = path_1.default.join(this.reportsDir, folderName);
        await (0, fs_extra_1.ensureDir)(folderPath);
        await (0, fs_extra_1.emptyDir)(folderPath);
    }
    async copyIfPresent(sourceFolder, targetFolder, label) {
        try {
            await (0, fs_extra_1.copy)(path_1.default.resolve(sourceFolder), path_1.default.join(this.reportsDir, targetFolder), { overwrite: true });
            this.logger.info(`${label} copied to reports/${targetFolder}/`);
        }
        catch {
            this.logger.warn(`No ${sourceFolder}/ directory found; skipping ${label} copy`);
        }
    }
    async optionalReportPath(relativePath) {
        const reportPath = path_1.default.join(this.reportsDir, relativePath);
        return await (0, fs_extra_1.pathExists)(reportPath) ? `reports/${relativePath.replace(/\\/g, '/')}` : undefined;
    }
}
exports.ReportingAgent = ReportingAgent;
//# sourceMappingURL=ReportingAgent.js.map