"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HealingAgent = void 0;
const fs_extra_1 = require("fs-extra");
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../../utils/logger"));
const LLMProvider_1 = require("../../framework/LLMProvider");
const FrameworkError_1 = require("../../framework/FrameworkError");
const Config_1 = require("../../framework/Config");
const cheerio_1 = __importDefault(require("cheerio"));
/**
 * HealingAgent – when a locator fails, this agent calls the configured LLM
 * to suggest a more stable selector. It updates the locator file and logs
 * the healing action in storage/healing-history.json.
 */
class HealingAgent {
    constructor() {
        this.logger = logger_1.default.getInstance();
        this.historyPath = path_1.default.resolve('storage', 'healing-history.json');
        this.promptPath = path_1.default.resolve('prompts', 'healing.txt');
    }
    async run(locatorFile, failedSelector, pageHtmlSnippet = '', targetRequirement = 'Single Element (1 of 1)') {
        try {
            const normalizedFailedSelector = this.normalizeSelector(failedSelector);
            this.logger.info(`HealingAgent: healing selector "${normalizedFailedSelector}" in ${locatorFile}`);
            const pageContext = pageHtmlSnippet || await this.readBestPageContext();
            const inferredRequirement = this.inferTargetRequirement(normalizedFailedSelector, pageContext, targetRequirement);
            const codeHealing = await this.tryApplyCodeHealing(locatorFile, normalizedFailedSelector, pageContext);
            if (codeHealing) {
                await this.recordHistory(normalizedFailedSelector, codeHealing, locatorFile);
                this.logger.info(`HealingAgent: generated code updated successfully`);
                return codeHealing;
            }
            const inferredSuggestion = this.inferStableSelector(normalizedFailedSelector, pageContext);
            let promptSuggestion = '';
            if (!inferredSuggestion) {
                if (!Config_1.Config.get().aiEnabled) {
                    throw new FrameworkError_1.FrameworkError('AI features are disabled and local DOM inference could not find a stable selector', undefined, 'HEAL_AI_DISABLED');
                }
                const provider = LLMProvider_1.LLMProviderFactory.getProvider();
                const template = await (0, fs_extra_1.readFile)(this.promptPath, 'utf-8');
                this.logger.info(`HealingAgent: using prompt template ${this.promptPath}`);
                const prompt = template
                    .replace('{{FAILED_SELECTOR}}', normalizedFailedSelector)
                    .replace('{{PAGE_HTML_SNIPPET}}', pageContext || 'Not available')
                    .replace('{{TARGET_REQUIREMENT}}', inferredRequirement);
                const rawSuggestion = await provider.generate(prompt);
                promptSuggestion = this.cleanSelector(rawSuggestion);
            }
            const suggestion = this.guardHealedSelector(normalizedFailedSelector, inferredSuggestion || promptSuggestion);
            this.validateSelector(suggestion);
            if (this.normalizeSelector(suggestion) === normalizedFailedSelector) {
                throw new FrameworkError_1.FrameworkError('Healing suggestion did not change the failed selector', undefined, 'HEAL_NOOP_SELECTOR');
            }
            this.logger.info(`HealingAgent: accepted ${inferredSuggestion ? 'local inference' : 'prompt output'} "${suggestion}"`);
            const targetFile = await this.findFileContainingSelector(locatorFile, normalizedFailedSelector);
            const content = await (0, fs_extra_1.readFile)(targetFile, 'utf-8');
            const updated = this.replaceSelector(content, normalizedFailedSelector, suggestion);
            if (updated === content) {
                throw new FrameworkError_1.FrameworkError('Failed selector was not found in locator file', undefined, 'HEAL_SELECTOR_NOT_FOUND');
            }
            await (0, fs_extra_1.writeFile)(targetFile, updated);
            await this.recordHistory(normalizedFailedSelector, suggestion, targetFile);
            this.logger.info(`HealingAgent: locator file updated successfully`);
            return suggestion;
        }
        catch (err) {
            this.logger.error('HealingAgent failed', { error: err });
            if (err instanceof FrameworkError_1.FrameworkError) {
                throw err;
            }
            const message = err instanceof Error ? err.message : String(err);
            throw new FrameworkError_1.FrameworkError(`Healing failed: ${message}`, err, 'HEAL_FAIL');
        }
    }
    async findFileContainingSelector(preferredFile, failedSelector) {
        const scopedCandidates = await this.findCurrentRunLocatorFiles(preferredFile);
        for (const candidate of scopedCandidates) {
            const content = await (0, fs_extra_1.readFile)(candidate, 'utf-8');
            if (this.contentHasSelector(content, failedSelector))
                return candidate;
        }
        try {
            const preferredContent = await (0, fs_extra_1.readFile)(preferredFile, 'utf-8');
            if (this.contentHasSelector(preferredContent, failedSelector))
                return preferredFile;
        }
        catch {
            // Continue with generated folder search.
        }
        const generatedDir = path_1.default.resolve('generated');
        const candidates = await this.listTypeScriptFiles(generatedDir);
        for (const candidate of candidates) {
            const content = await (0, fs_extra_1.readFile)(candidate, 'utf-8');
            if (this.contentHasSelector(content, failedSelector))
                return candidate;
        }
        return preferredFile;
    }
    async findCurrentRunLocatorFiles(entryFile) {
        const visited = new Set();
        const orderedFiles = [];
        await this.collectRelativeImportGraph(path_1.default.resolve(entryFile), visited, orderedFiles);
        return orderedFiles.filter((file) => /[\\/]locators[\\/]|locator/i.test(path_1.default.basename(file)));
    }
    async collectRelativeImportGraph(file, visited, orderedFiles) {
        const absoluteFile = path_1.default.resolve(file);
        if (visited.has(absoluteFile) || !await (0, fs_extra_1.pathExists)(absoluteFile))
            return;
        visited.add(absoluteFile);
        orderedFiles.push(absoluteFile);
        let content = '';
        try {
            content = await (0, fs_extra_1.readFile)(absoluteFile, 'utf-8');
        }
        catch {
            return;
        }
        for (const importName of this.getRelativeImportNames(content)) {
            const importedFile = await this.resolveRelativeImport(absoluteFile, importName);
            if (importedFile) {
                await this.collectRelativeImportGraph(importedFile, visited, orderedFiles);
            }
        }
    }
    getRelativeImportNames(code) {
        return Array.from(code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g))
            .map((match) => match[1])
            .filter((importName) => !importName.includes('src/framework') && !importName.includes('src/utils'));
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
    async tryApplyCodeHealing(preferredFile, failedSelector, pageContext) {
        if (!this.isStrictTextAssertionFailure(failedSelector, pageContext))
            return undefined;
        const targetFile = await this.findGeneratedPageFile(preferredFile);
        if (!targetFile)
            return undefined;
        const content = await (0, fs_extra_1.readFile)(targetFile, 'utf-8');
        const updated = this.patchTextAssertionStrictMode(content);
        if (updated === content)
            return undefined;
        await (0, fs_extra_1.writeFile)(targetFile, updated);
        return `code:${path_1.default.basename(targetFile)}:strict-text-filter`;
    }
    isStrictTextAssertionFailure(failedSelector, pageContext) {
        return /strict mode violation|resolved to \d+ elements/i.test(pageContext)
            && /toContainText|Expected substring/i.test(pageContext)
            && Boolean(failedSelector);
    }
    async findGeneratedPageFile(preferredFile) {
        const contextFile = await this.extractPageFileFromLatestContext();
        if (contextFile)
            return contextFile;
        const generatedDir = path_1.default.resolve('generated', 'pages');
        try {
            const candidates = await this.listTypeScriptFiles(generatedDir);
            return candidates[0];
        }
        catch {
            return preferredFile.includes(`${path_1.default.sep}pages${path_1.default.sep}`) ? preferredFile : undefined;
        }
    }
    async extractPageFileFromLatestContext() {
        const context = await this.readLatestErrorContext();
        const match = context.match(/at\s+pages\\([^:\r\n]+\.ts):\d+/i)
            ?? context.match(/generated\\pages\\([^:\r\n]+\.ts):\d+/i);
        if (!match?.[1])
            return undefined;
        const filePath = path_1.default.resolve('generated', 'pages', match[1]);
        try {
            await (0, fs_extra_1.stat)(filePath);
            return filePath;
        }
        catch {
            return undefined;
        }
    }
    patchTextAssertionStrictMode(content) {
        let updated = content.replace(/await\s+expect\((this\.page\.locator\(this\.locators\[[^\]]+\]\))\)\.toContainText\(([^;\n]+)\);/g, (_match, locatorExpression, args) => {
            const valueArg = String(args).split(',')[0].trim();
            return `const matchingElement = ${locatorExpression}.filter({ hasText: ${valueArg} }).first();\n    await expect(matchingElement).toContainText(${args});`;
        });
        updated = updated.replace(/await\s+expect\((this\.locator\([^)]+\))\)\.toContainText\(([^;\n]+)\);/g, (_match, locatorExpression, args) => {
            const valueArg = String(args).split(',')[0].trim();
            return `const matchingElement = ${locatorExpression}.filter({ hasText: ${valueArg} }).first();\n    await expect(matchingElement).toContainText(${args});`;
        });
        return updated;
    }
    async listTypeScriptFiles(dir) {
        const entries = await (0, fs_extra_1.readdir)(dir);
        const files = [];
        for (const entry of entries) {
            const fullPath = path_1.default.join(dir, entry);
            const info = await (0, fs_extra_1.stat)(fullPath);
            if (info.isDirectory()) {
                files.push(...await this.listTypeScriptFiles(fullPath));
            }
            else if (entry.endsWith('.ts')) {
                files.push(fullPath);
            }
        }
        return files;
    }
    cleanSelector(output) {
        const trimmed = output.trim();
        const fenced = trimmed.match(/^```(?:css|xpath)?\s*([\s\S]*?)\s*```$/i);
        return this.normalizeSelector((fenced ? fenced[1] : trimmed).trim().replace(/^['"]|['"]$/g, ''));
    }
    normalizeSelector(selector) {
        return selector
            .trim()
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\')
            .replace(/^['"]|['"]$/g, '');
    }
    validateSelector(selector) {
        if (!selector) {
            throw new FrameworkError_1.FrameworkError('Healing suggestion is empty', undefined, 'HEAL_EMPTY');
        }
        if (selector.includes('\n') || selector.includes(';')) {
            throw new FrameworkError_1.FrameworkError('Healing suggestion is not a single selector', undefined, 'HEAL_INVALID_SELECTOR');
        }
    }
    guardHealedSelector(failedSelector, suggestion) {
        return suggestion;
    }
    contentHasSelector(content, selector) {
        return this.selectorReplacementPairs(selector, selector).some(({ oldValue }) => content.includes(oldValue));
    }
    replaceSelector(content, oldSelector, newSelector) {
        let updated = content;
        for (const pair of this.selectorReplacementPairs(oldSelector, newSelector)) {
            if (updated.includes(pair.oldValue)) {
                updated = updated.split(pair.oldValue).join(pair.newValue);
            }
        }
        return updated;
    }
    selectorReplacementPairs(oldSelector, newSelector) {
        const normalizedOldSelector = this.normalizeSelector(oldSelector);
        const normalizedNewSelector = this.normalizeSelector(newSelector);
        const pairs = [
            { oldValue: normalizedOldSelector, newValue: normalizedNewSelector },
            { oldValue: this.escapeForDoubleQuotedString(normalizedOldSelector), newValue: this.escapeForDoubleQuotedString(normalizedNewSelector) },
            { oldValue: this.escapeForSingleQuotedString(normalizedOldSelector), newValue: this.escapeForSingleQuotedString(normalizedNewSelector) },
            { oldValue: this.escapeForTemplateString(normalizedOldSelector), newValue: this.escapeForTemplateString(normalizedNewSelector) },
        ];
        return [
            ...pairs,
            ...this.xpathAttributeQuoteVariants(normalizedOldSelector, normalizedNewSelector),
        ];
    }
    xpathAttributeQuoteVariants(oldSelector, newSelector) {
        const match = oldSelector.match(/^(.*@\w+\s*=\s*)(['"]?)([^'"\]]+)\2(\].*)$/);
        if (!match)
            return [];
        const [, prefix, , value, suffix] = match;
        const oldVariants = [
            `${prefix}'${value}'${suffix}`,
            `${prefix}"${value}"${suffix}`,
            `${prefix}${value}${suffix}`,
        ];
        return oldVariants.flatMap((oldValue) => [
            { oldValue, newValue: newSelector },
            { oldValue: this.escapeForDoubleQuotedString(oldValue), newValue: this.escapeForDoubleQuotedString(newSelector) },
            { oldValue: this.escapeForSingleQuotedString(oldValue), newValue: this.escapeForSingleQuotedString(newSelector) },
        ]);
    }
    escapeForDoubleQuotedString(value) {
        return JSON.stringify(value).slice(1, -1);
    }
    escapeForSingleQuotedString(value) {
        return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }
    escapeForTemplateString(value) {
        return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
    }
    async readLatestErrorContext() {
        const resultsDir = path_1.default.resolve('test-results');
        try {
            const files = await this.listFilesByName(resultsDir, 'error-context.md');
            const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
            return newest ? await (0, fs_extra_1.readFile)(newest.file, 'utf-8') : '';
        }
        catch {
            return '';
        }
    }
    async readBestPageContext() {
        const [errorContext, domSnapshot] = await Promise.all([
            this.readLatestErrorContext(),
            this.readLatestDomSnapshot(),
        ]);
        return [
            errorContext,
            domSnapshot ? `\n\n--- DOM SNAPSHOT ---\n${domSnapshot}` : '',
        ].filter(Boolean).join('\n');
    }
    async readLatestDomSnapshot() {
        const healingDir = path_1.default.resolve('reports', 'healing');
        try {
            const files = await this.listFilesMatching(healingDir, /^dom-.*\.html$/i);
            const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
            if (!newest)
                return '';
            const html = await (0, fs_extra_1.readFile)(newest.file, 'utf-8');
            return this.sanitizeHtml(html);
        }
        catch {
            return '';
        }
    }
    sanitizeHtml(html) {
        if (!html)
            return '';
        // 1. Remove script and style blocks
        let cleaned = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        // 2. Remove SVG paths/details but keep the tag to show presence
        cleaned = cleaned.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '[SVG]');
        // 3. Remove comments
        cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, '');
        // 4. Remove class and style attributes which bloat HTML tremendously
        cleaned = cleaned.replace(/\s+class=["'][^"']*["']/gi, '');
        cleaned = cleaned.replace(/\s+style=["'][^"']*["']/gi, '');
        cleaned = cleaned.replace(/\s+data-v-[a-zA-Z0-9_-]+(=["'][^"']*["'])?/gi, '');
        // 5. Clean up extra whitespace and empty lines
        cleaned = cleaned
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');
        // 6. Truncate to a safe size
        return cleaned.slice(0, 15000);
    }
    async listFilesByName(dir, fileName) {
        const entries = await (0, fs_extra_1.readdir)(dir);
        const files = [];
        for (const entry of entries) {
            const fullPath = path_1.default.join(dir, entry);
            const info = await (0, fs_extra_1.stat)(fullPath);
            if (info.isDirectory()) {
                files.push(...await this.listFilesByName(fullPath, fileName));
            }
            else if (entry === fileName) {
                files.push({ file: fullPath, mtimeMs: info.mtimeMs });
            }
        }
        return files;
    }
    async listFilesMatching(dir, pattern) {
        const entries = await (0, fs_extra_1.readdir)(dir);
        const files = [];
        for (const entry of entries) {
            const fullPath = path_1.default.join(dir, entry);
            const info = await (0, fs_extra_1.stat)(fullPath);
            if (info.isDirectory()) {
                files.push(...await this.listFilesMatching(fullPath, pattern));
            }
            else if (pattern.test(entry)) {
                files.push({ file: fullPath, mtimeMs: info.mtimeMs });
            }
        }
        return files;
    }
    inferTargetRequirement(failedSelector, pageContext, fallback) {
        return fallback;
    }
    inferStableSelector(failedSelector, pageContext) {
        return this.inferFromDomContext(failedSelector, pageContext);
    }
    /** Static convenience method used by CommonActions to get a fallback selector without needing an instance. */
    static inferStableSelectorStatic(failedSelector, pageContext) {
        const agent = new HealingAgent();
        // Using the protected method to perform inference.
        return agent.inferStableSelector(failedSelector, pageContext);
    }
    inferFromDomContext(failedSelector, pageContext) {
        if (!pageContext)
            return undefined;
        return this.inferStableSelectorFromDomElements(failedSelector, pageContext);
    }
    inferStableSelectorFromDomElements(failedSelector, pageContext) {
        const candidates = this.extractDomCandidates(pageContext);
        if (!candidates.length)
            return undefined;
        const ranked = candidates
            .filter((candidate) => this.candidateMatchesSelectorIntent(candidate, failedSelector))
            .map((candidate) => ({
            candidate,
            score: this.scoreDomCandidate(candidate, failedSelector),
        }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score || a.candidate.order - b.candidate.order);
        for (const { candidate } of ranked) {
            const selector = this.selectorForElement(candidate);
            if (selector && this.normalizeSelector(selector) !== this.normalizeSelector(failedSelector))
                return selector;
        }
        return undefined;
    }
    extractDomCandidates(pageContext) {
        // Use Cheerio for robust DOM parsing first
        const cheerioCandidates = this.extractDomCandidatesWithCheerio(pageContext);
        // Fallback to regex‑based extraction for any remaining cases
        const regexCandidates = this.extractHtmlElementCandidates(pageContext);
        const ariaCandidates = this.extractAriaSnapshotCandidates(pageContext);
        // Combine and deduplicate by unique tag+attributes+text
        const all = [...cheerioCandidates, ...regexCandidates, ...ariaCandidates];
        const uniq = new Map();
        for (const c of all) {
            const key = `${c.tag}|${JSON.stringify(c.attributes)}|${c.text}`;
            if (!uniq.has(key))
                uniq.set(key, c);
        }
        return Array.from(uniq.values());
    }
    /**
     * Parse the HTML using Cheerio and create stable element candidates.
     */
    extractDomCandidatesWithCheerio(pageContext) {
        if (!pageContext)
            return [];
        const $ = cheerio_1.default.load(pageContext);
        const candidates = [];
        const elements = $('*').toArray();
        elements.forEach((elem, idx) => {
            const tag = (elem.name || '').toLowerCase();
            const attribs = elem.attribs || {};
            const text = $(elem).text().trim();
            candidates.push(this.createDomCandidate(tag, this.normalizeAttributes(attribs), text, undefined, 'html', idx));
        });
        return candidates;
    }
    /** Convert raw attribute map to lower‑cased string map */
    normalizeAttributes(raw) {
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
            if (v !== undefined && v !== null)
                out[k.toLowerCase()] = v;
        }
        return out;
    }
    extractHtmlElementCandidates(pageContext) {
        return Array.from(pageContext.matchAll(/<(button|input|a|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi))
            .map((match, index) => {
            const tag = (match[1] || match[4] || '').toLowerCase();
            const attributes = this.parseAttributes(match[2] || match[5] || '');
            const text = this.stripHtml(match[3] || '');
            return this.createDomCandidate(tag, attributes, text, undefined, 'html', index);
        });
    }
    extractAriaSnapshotCandidates(pageContext) {
        const lines = pageContext.split(/\r?\n/);
        const candidates = [];
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const match = line.match(/^\s*-\s+(textbox|button|link|combobox|checkbox|radio|option|heading)\s*(?:"([^"]*)")?/i);
            if (!match)
                continue;
            const role = match[1].toLowerCase();
            const name = this.cleanAccessibleName(match[2] ?? '');
            const attributes = {};
            for (let lookAhead = index + 1; lookAhead < Math.min(lines.length, index + 8); lookAhead += 1) {
                const attributeMatch = lines[lookAhead].match(/^\s*-\s+\/?([a-zA-Z][\w-]*):\s*(.+?)\s*$/);
                if (attributeMatch) {
                    attributes[attributeMatch[1].toLowerCase()] = this.cleanAccessibleName(attributeMatch[2]);
                    continue;
                }
                if (/^\s*-\s+(textbox|button|link|combobox|checkbox|radio|option|heading)\b/i.test(lines[lookAhead])) {
                    break;
                }
            }
            candidates.push(this.createDomCandidate(this.tagForAriaRole(role), attributes, name, role, 'aria', index));
        }
        return candidates;
    }
    createDomCandidate(tag, attributes, text, role, source, order) {
        const searchText = [
            tag,
            role ?? '',
            text,
            Object.entries(attributes).map(([key, value]) => `${key} ${value}`).join(' '),
        ].join(' ').toLowerCase();
        return {
            tag,
            role,
            name: text,
            attributes,
            text,
            searchText,
            source,
            order,
        };
    }
    tagForAriaRole(role) {
        const tags = {
            textbox: 'input',
            button: 'button',
            link: 'a',
            combobox: 'select',
            checkbox: 'input',
            radio: 'input',
            option: 'option',
            heading: 'h1',
        };
        return tags[role] ?? role;
    }
    cleanAccessibleName(value) {
        return value
            .replace(/\[[^\]]+\]$/g, '')
            .replace(/^[^\w@./#-]+|[^\w@./#-]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    candidateMatchesSelectorIntent(candidate, failedSelector) {
        // Simple heuristic: ensure at least one significant word from the failed selector appears in the candidate's searchable text.
        const failedWords = this.significantWords(failedSelector);
        if (!failedWords.length)
            return true;
        const candidateText = candidate.searchText.toLowerCase();
        return failedWords.some(word => candidateText.includes(word));
    }
    scoreDomCandidate(candidate, failedSelector) {
        const failedWords = this.significantWords(failedSelector);
        const text = candidate.searchText;
        const matchCount = failedWords.filter((word) => text.includes(word)).length;
        if (failedWords.length > 0 && matchCount === 0) {
            return 0;
        }
        let score = matchCount * 2;
        if (!failedWords.length) {
            score += 1;
        }
        if (candidate.source === 'html')
            score += 1;
        return score;
    }
    selectorForElement(candidate) {
        const { tag, attributes, text, role } = candidate;
        const stableAttributes = ['data-testid', 'data-test', 'aria-label', 'name', 'placeholder'];
        const xpathTag = tag && tag !== '*' ? tag : '*';
        // Prefer stable attributes (data-testid, aria-label, etc.)
        for (const attribute of stableAttributes) {
            const value = attributes[attribute];
            if (value && !this.isDynamicValue(value)) {
                return `//${xpathTag}[@${attribute}='${this.escapeAttributeValue(value)}']`;
            }
        }
        // Fallback to id if stable
        const id = attributes.id;
        if (id && !this.isDynamicValue(id)) {
            return `//${xpathTag}[@id='${this.escapeAttributeValue(id)}']`;
        }
        const visibleText = text.trim().replace(/\s+/g, ' ');
        // High‑level Playwright selectors based on role or visible text
        if (visibleText) {
            if (tag === 'button') {
                return `role=button[name="${this.escapeAttributeValue(visibleText)}"]`;
            }
            if (tag === 'a') {
                return `role=link[name="${this.escapeAttributeValue(visibleText)}"]`;
            }
            // generic text selector fallback
            return `text="${this.escapeAttributeValue(visibleText)}"`;
        }
        // Specific fallbacks for common input types
        if ((role === 'textbox' || tag === 'input' || tag === 'textarea') && /email|e-mail/i.test(visibleText)) {
            return "//input[@type='email']";
        }
        if ((role === 'textbox' || tag === 'input') && /password|passcode/i.test(visibleText)) {
            return "//input[@type='password']";
        }
        // Anchor with explicit URL
        if (tag === 'a' && attributes.url) {
            return `//a[@href='${this.escapeAttributeValue(attributes.url)}']`;
        }
        return undefined;
    }
    parseAttributes(rawAttributes) {
        const attributes = {};
        for (const match of rawAttributes.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
            attributes[match[1].toLowerCase()] = match[3];
        }
        return attributes;
    }
    stripHtml(value) {
        return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    significantWords(value) {
        const stopWords = new Set(['locator', 'button', 'input', 'field', 'element', 'text', 'type', 'submit']);
        return (value.match(/[a-zA-Z0-9]+/g) ?? [])
            .map((word) => word.toLowerCase())
            .filter((word) => word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word));
    }
    isDynamicValue(value) {
        return /\b(\d{3,}|[a-f0-9]{8,}|react|mui|mat|headlessui|jss|css-|sc-)\b/i.test(value);
    }
    escapeAttributeValue(value) {
        return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
    escapeCssIdentifier(value) {
        return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
    }
    isGenericSelector(selector) {
        return /^(button|input|select|textarea)(\[type=["']?\w+["']?\])?$/.test(selector)
            || /^button:has-text\(["']add to cart["']\)$/i.test(selector)
            || selector === '*';
    }
    async recordHistory(oldSelector, newSelector, file) {
        await (0, fs_extra_1.ensureDir)(path_1.default.dirname(this.historyPath));
        let history = [];
        try {
            const raw = await (0, fs_extra_1.readFile)(this.historyPath, 'utf-8');
            history = JSON.parse(raw);
        }
        catch {
            // file does not exist yet – start fresh
        }
        history.push({
            timestamp: new Date().toISOString(),
            file: path_1.default.basename(file),
            oldSelector,
            newSelector,
        });
        await (0, fs_extra_1.writeFile)(this.historyPath, JSON.stringify(history, null, 2));
    }
}
exports.HealingAgent = HealingAgent;
//# sourceMappingURL=HealingAgent.js.map