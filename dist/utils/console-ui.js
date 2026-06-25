"use strict";
/**
 * Console UI utilities for readable AI-Playwright pipeline output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.pipelineHeader = pipelineHeader;
exports.stageStart = stageStart;
exports.stagePass = stagePass;
exports.stageFail = stageFail;
exports.divider = divider;
exports.banner = banner;
exports.executionLog = executionLog;
exports.pipelineSummary = pipelineSummary;
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const FG_RED = '\x1b[31m';
const FG_GREEN = '\x1b[32m';
const FG_YELLOW = '\x1b[33m';
const FG_BLUE = '\x1b[34m';
const FG_MAGENTA = '\x1b[35m';
const FG_CYAN = '\x1b[36m';
const FG_WHITE = '\x1b[37m';
const BG_GREEN = '\x1b[42m';
const BG_RED = '\x1b[41m';
const BG_BLUE = '\x1b[44m';
const BG_MAGENTA = '\x1b[45m';
const BG_CYAN = '\x1b[46m';
const BG_YELLOW = '\x1b[43m';
const STAGE_COLORS = {
    1: { bg: BG_BLUE, fg: FG_BLUE, icon: 'PLAN' },
    2: { bg: BG_MAGENTA, fg: FG_MAGENTA, icon: 'API' },
    3: { bg: BG_CYAN, fg: FG_CYAN, icon: 'GEN' },
    4: { bg: BG_YELLOW, fg: FG_YELLOW, icon: 'SEC' },
    5: { bg: BG_CYAN, fg: FG_CYAN, icon: 'RUN' },
    6: { bg: BG_YELLOW, fg: FG_YELLOW, icon: 'HEAL' },
    7: { bg: BG_GREEN, fg: FG_GREEN, icon: 'REPORT' },
};
function line(char = '-', length = 70) {
    return char.repeat(length);
}
function pipelineHeader(requestFile) {
    const fileName = requestFile.split(/[/\\]/).pop() || requestFile;
    console.log('');
    console.log(`${BOLD}${FG_CYAN}${line('=')}${RESET}`);
    console.log(`${BOLD}${FG_CYAN}  AI-PLAYWRIGHT AUTOMATION PIPELINE${RESET}`);
    console.log(`${BOLD}${FG_CYAN}${line('=')}${RESET}`);
    console.log(`${DIM}${FG_WHITE}  Request : ${fileName}${RESET}`);
    console.log(`${DIM}${FG_WHITE}  Time    : ${new Date().toLocaleTimeString()}${RESET}`);
    console.log(`${BOLD}${FG_CYAN}${line('-')}${RESET}`);
    console.log('');
}
function stageStart(stageNum, name, description) {
    const colors = STAGE_COLORS[stageNum] || STAGE_COLORS[1];
    console.log('');
    console.log(`${BOLD}${colors.fg}${line('-')}${RESET}`);
    console.log(`${BOLD}${colors.bg}${FG_WHITE}  STAGE ${stageNum}  ${RESET} ${BOLD}${colors.fg} ${colors.icon}  ${name}${RESET}`);
    console.log(`${DIM}${FG_WHITE}  ${description}${RESET}`);
    console.log(`${BOLD}${colors.fg}${line('-')}${RESET}`);
}
function stagePass(stageNum, name, detail) {
    const colors = STAGE_COLORS[stageNum] || STAGE_COLORS[1];
    console.log(`${BOLD}${FG_GREEN}  PASS ${name} completed successfully${RESET}`);
    console.log(`${DIM}${FG_WHITE}     ${detail}${RESET}`);
    console.log(`${DIM}${colors.fg}${line('.', 40)}${RESET}`);
}
function stageFail(_stageNum, name, detail) {
    console.log(`${BOLD}${FG_RED}  FAIL ${name}${RESET}`);
    console.log(`${DIM}${FG_RED}     ${detail}${RESET}`);
    console.log('');
}
function divider() {
    console.log(`${DIM}${FG_WHITE}${line('.')}${RESET}`);
}
function banner(message, type = 'info') {
    const colorMap = {
        info: FG_CYAN,
        success: FG_GREEN,
        error: FG_RED,
        warn: FG_YELLOW,
    };
    console.log(`${BOLD}${colorMap[type]}${message}${RESET}`);
}
function executionLog(type, title, detail = '') {
    const colorMap = {
        info: FG_CYAN,
        action: FG_MAGENTA,
        success: FG_GREEN,
        warn: FG_YELLOW,
        error: FG_RED,
        heal: FG_BLUE,
        skip: FG_YELLOW,
    };
    const labelMap = {
        info: 'EXEC',
        action: 'ACTION',
        success: 'PASS',
        warn: 'WARN',
        error: 'FAIL',
        heal: 'HEAL',
        skip: 'SKIP',
    };
    const suffix = detail ? `${DIM}${FG_WHITE} - ${detail}${RESET}` : '';
    console.log(`${BOLD}${colorMap[type]}[${labelMap[type]}] ${title}${RESET}${suffix}`);
}
function pipelineSummary(passed, elapsedSeconds) {
    console.log('');
    console.log(`${BOLD}${FG_CYAN}${line('=')}${RESET}`);
    if (passed) {
        console.log(`${BOLD}${BG_GREEN}${FG_WHITE}  PIPELINE PASSED  ${RESET}  ${FG_GREEN}All stages completed successfully${RESET}`);
    }
    else {
        console.log(`${BOLD}${BG_RED}${FG_WHITE}  PIPELINE FAILED  ${RESET}  ${FG_RED}One or more stages failed${RESET}`);
    }
    console.log(`${DIM}${FG_WHITE}  Total time: ${elapsedSeconds}s${RESET}`);
    const cwd = process.cwd().replace(/\\/g, '/');
    console.log(`${DIM}${FG_WHITE}  HTML Report -> file:///${cwd}/reports/html/index.html${RESET}`);
    console.log(`${DIM}${FG_WHITE}  Test Results -> file:///${cwd}/reports/test-results/${RESET}`);
    console.log(`${DIM}${FG_WHITE}  Framework Logs -> file:///${cwd}/reports/logs/framework.log${RESET}`);
    console.log(`${BOLD}${FG_CYAN}${line('=')}${RESET}`);
    console.log('');
}
//# sourceMappingURL=console-ui.js.map