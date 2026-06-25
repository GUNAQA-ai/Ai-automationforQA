import { copy, emptyDir, ensureDir, pathExists, writeFile, readFile } from 'fs-extra';
import path from 'path';
import Logger from '../../utils/logger';
import { FrameworkError } from '../../framework/FrameworkError';
import { FrameworkApiExtractor } from '../../utils/FrameworkApiExtractor';

/**
 * ReportingAgent refreshes report folders and writes a single summary JSON.
 */
export class ReportingAgent {
  private readonly logger = Logger.getInstance();
  private readonly reportsDir = path.resolve('reports');

  async run(): Promise<void> {
    try {
      await ensureDir(this.reportsDir);
      await this.resetReportFolder('html');
      await this.resetReportFolder('allure-report');
      await this.resetReportFolder('allure-results');
      await this.resetReportFolder('test-results');
      await ensureDir(path.join(this.reportsDir, 'screenshots'));
      await ensureDir(path.join(this.reportsDir, 'videos'));
      await ensureDir(path.join(this.reportsDir, 'logs'));

      await this.copyIfPresent('playwright-report', 'html', 'HTML report');
      await this.copyIfPresent('allure-report', 'allure-report', 'Allure report');
      await this.copyIfPresent('allure-results', 'allure-results', 'Allure results');
      await this.copyIfPresent('test-results', 'test-results', 'Playwright test results');

      const apiDocs = await FrameworkApiExtractor.extractApiDocs();
      const capabilities = apiDocs.split('\n')
        .filter(line => line.trim().startsWith('- `'))
        .map(line => line.replace('- `', '').split('`')[0]);

      const summary = {
        generatedAt: new Date().toISOString(),
        frameworkCapabilitiesLoaded: capabilities.length,
        capabilities,
        htmlReport: 'reports/html/index.html',
        allureReport: 'reports/allure-report/index.html',
        allureResults: 'reports/allure-results',
        testResults: 'reports/test-results',
        apiReport: await this.optionalReportPath('api/api-summary.json'),
        securityReport: await this.optionalReportPath('security/security-summary.json'),
      };

      await writeFile(path.join(this.reportsDir, 'summary.json'), JSON.stringify(summary, null, 2));
      await this.generateExecutiveHtml(summary);
      this.logger.info('Report summary written to reports/summary.json');
    } catch (err) {
      this.logger.error('ReportingAgent failed', { error: err });
      throw new FrameworkError('Reporting failed', err as Error, 'REPORT_FAIL');
    }
  }

  private async resetReportFolder(folderName: string): Promise<void> {
    const folderPath = path.join(this.reportsDir, folderName);
    await ensureDir(folderPath);
    await emptyDir(folderPath);
  }

  private async copyIfPresent(sourceFolder: string, targetFolder: string, label: string): Promise<void> {
    try {
      await copy(path.resolve(sourceFolder), path.join(this.reportsDir, targetFolder), { overwrite: true });
      this.logger.info(`${label} copied to reports/${targetFolder}/`);
    } catch {
      this.logger.warn(`No ${sourceFolder}/ directory found; skipping ${label} copy`);
    }
  }

  private async optionalReportPath(relativePath: string): Promise<string | undefined> {
    const reportPath = path.join(this.reportsDir, relativePath);
    return await pathExists(reportPath) ? `reports/${relativePath.replace(/\\/g, '/')}` : undefined;
  }

  private async generateExecutiveHtml(summary: any): Promise<void> {
    const historyPath = path.resolve('storage', 'healing-history.json');
    let healingHistory: any[] = [];
    try {
      if (await pathExists(historyPath)) {
        healingHistory = JSON.parse(await readFile(historyPath, 'utf-8'));
      }
    } catch (e) {}

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Automation Executive Summary</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; color: #333; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 10px; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin-top: 20px; }
        .card { background: #ecf0f1; padding: 20px; border-radius: 8px; border-left: 5px solid #3498db; }
        .card.healing { border-left-color: #e74c3c; }
        .card.capabilities { border-left-color: #2ecc71; }
        h3 { margin-top: 0; color: #2c3e50; }
        .metric { font-size: 2.5em; font-weight: bold; color: #2980b9; }
        .metric.red { color: #e74c3c; }
        .metric.green { color: #2ecc71; }
        .list { list-style: none; padding: 0; }
        .list li { padding: 8px 0; border-bottom: 1px solid #ddd; font-size: 1.1em; }
        .list a { color: #3498db; text-decoration: none; font-weight: bold; }
        .list a:hover { text-decoration: underline; }
        .footer { margin-top: 30px; text-align: center; color: #7f8c8d; font-size: 0.9em; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 AI Automation Executive Summary</h1>
        <p>Generated on: <strong>${new Date(summary.generatedAt).toLocaleString()}</strong></p>
        
        <div class="grid">
            <div class="card capabilities">
                <h3>Framework Intelligence</h3>
                <p>The Dynamic Test Engine successfully routed operations through the consolidated API architecture.</p>
                <div class="metric green">${summary.frameworkCapabilitiesLoaded}</div>
                <p>Advanced Capabilities Available</p>
            </div>
            
            <div class="card healing">
                <h3>AI Healing ROI</h3>
                <p>Number of broken UI tests successfully rescued dynamically by the AI during execution.</p>
                <div class="metric red">${healingHistory.length}</div>
                <p>Tests Saved from Failure</p>
            </div>
        </div>

        <div class="grid">
            <div class="card">
                <h3>Utilized AI Capabilities</h3>
                <ul class="list">
                    ${summary.capabilities.map((c: string) => `<li>✔️ ${c}</li>`).join('')}
                </ul>
            </div>
            
            <div class="card">
                <h3>Deep Dive Reports</h3>
                <ul class="list">
                    <li><a href="html/index.html" target="_blank">View Detailed Playwright UI Report</a></li>
                    <li><a href="allure-report/index.html" target="_blank">View Allure Analytics Report</a></li>
                    ${summary.apiReport ? `<li><a href="${summary.apiReport.replace('reports/', '')}" target="_blank">View API Analysis</a></li>` : ''}
                    ${summary.securityReport ? `<li><a href="${summary.securityReport.replace('reports/', '')}" target="_blank">View Security Scan</a></li>` : ''}
                </ul>
            </div>
        </div>
        
        <div class="footer">
            <p>Powered by the Next-Generation AI Automation Framework</p>
        </div>
    </div>
</body>
</html>`;

    await writeFile(path.join(this.reportsDir, 'executive-summary.html'), html);
    this.logger.info('Executive HTML Dashboard generated at reports/executive-summary.html');
  }
}
