import { readFile, writeFile, ensureDir, pathExists, readdir, stat } from 'fs-extra';
import path from 'path';
import Logger from '../../utils/logger';
import { LLMProviderFactory } from '../../framework/LLMProvider';
import { FrameworkError } from '../../framework/FrameworkError';
import { Config } from '../../framework/Config';
import { FrameworkApiExtractor } from '../../utils/FrameworkApiExtractor';
import * as cheerio from 'cheerio';

interface DomElementCandidate {
  tag: string;
  role?: string;
  name?: string;
  attributes: Record<string, string>;
  text: string;
  searchText: string;
  source: 'html' | 'aria';
  order: number;
}

/**
 * HealingAgent – when a locator fails, this agent calls the configured LLM
 * to suggest a more stable selector. It updates the locator file and logs
 * the healing action in storage/healing-history.json.
 */
export class HealingAgent {
  private readonly logger = Logger.getInstance();
  private readonly historyPath = path.resolve('storage', 'healing-history.json');
  private readonly promptPath = path.resolve('prompts', 'healing.txt');

  async run(locatorFile: string, failedSelector: string, pageHtmlSnippet = '', targetRequirement = 'Single Element (1 of 1)'): Promise<string> {
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
        if (!Config.get().aiEnabled) {
          throw new FrameworkError('AI features are disabled and local DOM inference could not find a stable selector', undefined, 'HEAL_AI_DISABLED');
        }
        const provider = LLMProviderFactory.getProvider();
        const template = await readFile(this.promptPath, 'utf-8');
        const frameworkApiDoc = await FrameworkApiExtractor.extractApiDocs();
        this.logger.info(`HealingAgent: using prompt template ${this.promptPath}`);
        const prompt = template
          .replace('{{FAILED_SELECTOR}}', normalizedFailedSelector)
          .replace('{{PAGE_HTML_SNIPPET}}', pageContext || 'Not available')
          .replace('{{TARGET_REQUIREMENT}}', inferredRequirement)
          .replace('{{FRAMEWORK_API}}', frameworkApiDoc);

        const rawSuggestion = await provider.generate(prompt);
        promptSuggestion = this.cleanSelector(rawSuggestion);
      }

      const suggestion = this.guardHealedSelector(normalizedFailedSelector, inferredSuggestion || promptSuggestion);
      this.validateSelector(suggestion);
      if (this.normalizeSelector(suggestion) === normalizedFailedSelector) {
        throw new FrameworkError('Healing suggestion did not change the failed selector', undefined, 'HEAL_NOOP_SELECTOR');
      }
      this.logger.info(`HealingAgent: accepted ${inferredSuggestion ? 'local inference' : 'prompt output'} "${suggestion}"`);

      const locatorsDir = path.resolve('generated', 'locators');
      let updated = false;
      let targetJsonPath = '';
      if (await pathExists(locatorsDir)) {
        const files = await readdir(locatorsDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = path.join(locatorsDir, file);
          try {
            const content = await readFile(filePath, 'utf-8');
            const data = JSON.parse(content);
            if (data && typeof data === 'object' && data.locators && typeof data.locators === 'object') {
              let fileUpdated = false;
              for (const [key, val] of Object.entries(data.locators)) {
                if (this.selectorsMatch(val as string, normalizedFailedSelector)) {
                  data.locators[key] = suggestion;
                  fileUpdated = true;
                  updated = true;
                }
              }
              if (fileUpdated) {
                await writeFile(filePath, JSON.stringify(data, null, 2));
                targetJsonPath = filePath;
                this.logger.info(`HealingAgent: updated selector in local JSON ${filePath}`);
              }
            }
          } catch (e) {
            // ignore parse/read errors of individual files
          }
        }
      }

      if (!updated) {
        throw new FrameworkError('Failed selector was not found in any local locator JSON files', undefined, 'HEAL_SELECTOR_NOT_FOUND');
      }

      await this.recordHistory(normalizedFailedSelector, suggestion, targetJsonPath);

      return suggestion;
    } catch (err) {
      this.logger.error('HealingAgent failed', { error: err });
      if (err instanceof FrameworkError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new FrameworkError(`Healing failed: ${message}`, err as Error, 'HEAL_FAIL');
    }
  }

  private async findFileContainingSelector(preferredFile: string, failedSelector: string): Promise<string> {
    const scopedCandidates = await this.findCurrentRunLocatorFiles(preferredFile);
    for (const candidate of scopedCandidates) {
      const content = await readFile(candidate, 'utf-8');
      if (this.contentHasSelector(content, failedSelector)) return candidate;
    }

    try {
      const preferredContent = await readFile(preferredFile, 'utf-8');
      if (this.contentHasSelector(preferredContent, failedSelector)) return preferredFile;
    } catch {
      // Continue with generated folder search.
    }

    const generatedDir = path.resolve('generated');
    const candidates = await this.listTypeScriptFiles(generatedDir);
    for (const candidate of candidates) {
      const content = await readFile(candidate, 'utf-8');
      if (this.contentHasSelector(content, failedSelector)) return candidate;
    }

    return preferredFile;
  }

  private async findCurrentRunLocatorFiles(entryFile: string): Promise<string[]> {
    const visited = new Set<string>();
    const orderedFiles: string[] = [];
    await this.collectRelativeImportGraph(path.resolve(entryFile), visited, orderedFiles);
    return orderedFiles.filter((file) => /[\\/]locators[\\/]|locator/i.test(path.basename(file)));
  }

  private async collectRelativeImportGraph(file: string, visited: Set<string>, orderedFiles: string[]): Promise<void> {
    const absoluteFile = path.resolve(file);
    if (visited.has(absoluteFile) || !await pathExists(absoluteFile)) return;
    visited.add(absoluteFile);
    orderedFiles.push(absoluteFile);

    let content = '';
    try {
      content = await readFile(absoluteFile, 'utf-8');
    } catch {
      return;
    }

    for (const importName of this.getRelativeImportNames(content)) {
      const importedFile = await this.resolveRelativeImport(absoluteFile, importName);
      if (importedFile) {
        await this.collectRelativeImportGraph(importedFile, visited, orderedFiles);
      }
    }
  }

  private getRelativeImportNames(code: string): string[] {
    return Array.from(code.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g))
      .map((match) => match[1])
      .filter((importName) => !importName.includes('src/framework') && !importName.includes('src/utils'));
  }

  private async resolveRelativeImport(fromFile: string, importName: string): Promise<string | undefined> {
    const basePath = path.resolve(path.dirname(fromFile), importName);
    const candidates = [
      basePath,
      `${basePath}.ts`,
      path.join(basePath, 'index.ts'),
    ];

    for (const candidate of candidates) {
      if (await pathExists(candidate)) return candidate;
    }

    return undefined;
  }

  private async tryApplyCodeHealing(preferredFile: string, failedSelector: string, pageContext: string): Promise<string | undefined> {
    if (!this.isStrictTextAssertionFailure(failedSelector, pageContext)) return undefined;

    const targetFile = await this.findGeneratedPageFile(preferredFile);
    if (!targetFile) return undefined;

    const content = await readFile(targetFile, 'utf-8');
    const updated = this.patchTextAssertionStrictMode(content);
    if (updated === content) return undefined;

    await writeFile(targetFile, updated);
    return `code:${path.basename(targetFile)}:strict-text-filter`;
  }

  private isStrictTextAssertionFailure(failedSelector: string, pageContext: string): boolean {
    return /strict mode violation|resolved to \d+ elements/i.test(pageContext)
      && /toContainText|Expected substring/i.test(pageContext)
      && Boolean(failedSelector);
  }

  private async findGeneratedPageFile(preferredFile: string): Promise<string | undefined> {
    const contextFile = await this.extractPageFileFromLatestContext();
    if (contextFile) return contextFile;

    const generatedDir = path.resolve('generated', 'pages');
    try {
      const candidates = await this.listTypeScriptFiles(generatedDir);
      return candidates[0];
    } catch {
      return preferredFile.includes(`${path.sep}pages${path.sep}`) ? preferredFile : undefined;
    }
  }

  private async extractPageFileFromLatestContext(): Promise<string | undefined> {
    const context = await this.readLatestErrorContext();
    const match = context.match(/at\s+pages\\([^:\r\n]+\.ts):\d+/i)
      ?? context.match(/generated\\pages\\([^:\r\n]+\.ts):\d+/i);
    if (!match?.[1]) return undefined;

    const filePath = path.resolve('generated', 'pages', match[1]);
    try {
      await stat(filePath);
      return filePath;
    } catch {
      return undefined;
    }
  }

  private patchTextAssertionStrictMode(content: string): string {
    let updated = content.replace(
      /await\s+expect\((this\.page\.locator\(this\.locators\[[^\]]+\]\))\)\.toContainText\(([^;\n]+)\);/g,
      (_match, locatorExpression, args) => {
        const valueArg = String(args).split(',')[0].trim();
        return `const matchingElement = ${locatorExpression}.filter({ hasText: ${valueArg} }).first();\n    await expect(matchingElement).toContainText(${args});`;
      }
    );

    updated = updated.replace(
      /await\s+expect\((this\.locator\([^)]+\))\)\.toContainText\(([^;\n]+)\);/g,
      (_match, locatorExpression, args) => {
        const valueArg = String(args).split(',')[0].trim();
        return `const matchingElement = ${locatorExpression}.filter({ hasText: ${valueArg} }).first();\n    await expect(matchingElement).toContainText(${args});`;
      }
    );

    return updated;
  }

  private async listTypeScriptFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir);
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        files.push(...await this.listTypeScriptFiles(fullPath));
      } else if (entry.endsWith('.ts')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private cleanSelector(output: string): string {
    const trimmed = output.trim();
    const fenced = trimmed.match(/```(?:css|xpath)?\s*([\s\S]*?)\s*```/i);
    return this.normalizeSelector((fenced ? fenced[1] : trimmed).trim().replace(/^['"]|['"]$/g, ''));
  }

  private normalizeSelector(selector: string): string {
    return selector
      .trim()
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/^['"]|['"]$/g, '');
  }

  private selectorsMatch(a: string, b: string): boolean {
    const normA = this.normalizeSelector(a).toLowerCase().replace(/[^a-z0-9]/g, '');
    const normB = this.normalizeSelector(b).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normA || !normB) return false;
    return normA === normB || normA.includes(normB) || normB.includes(normA);
  }

  private validateSelector(selector: string): void {
    if (!selector) {
      throw new FrameworkError('Healing suggestion is empty', undefined, 'HEAL_EMPTY');
    }

    if (selector.includes('\n') || selector.includes(';')) {
      throw new FrameworkError('Healing suggestion is not a single selector', undefined, 'HEAL_INVALID_SELECTOR');
    }
  }

  private guardHealedSelector(failedSelector: string, suggestion: string): string {
    return suggestion;
  }

  private contentHasSelector(content: string, selector: string): boolean {
    return this.selectorReplacementPairs(selector, selector).some(({ oldValue }) => content.includes(oldValue));
  }

  private replaceSelector(content: string, oldSelector: string, newSelector: string): string {
    let updated = content;
    for (const pair of this.selectorReplacementPairs(oldSelector, newSelector)) {
      if (updated.includes(pair.oldValue)) {
        updated = updated.split(pair.oldValue).join(pair.newValue);
      }
    }
    return updated;
  }

  private selectorReplacementPairs(oldSelector: string, newSelector: string): Array<{ oldValue: string; newValue: string }> {
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

  private xpathAttributeQuoteVariants(oldSelector: string, newSelector: string): Array<{ oldValue: string; newValue: string }> {
    const match = oldSelector.match(/^(.*@\w+\s*=\s*)(['"]?)([^'"\]]+)\2(\].*)$/);
    if (!match) return [];

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

  private escapeForDoubleQuotedString(value: string): string {
    return JSON.stringify(value).slice(1, -1);
  }

  private escapeForSingleQuotedString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private escapeForTemplateString(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  }

  private async readLatestErrorContext(): Promise<string> {
    const resultsDir = path.resolve('test-results');
    try {
      const files = await this.listFilesByName(resultsDir, 'error-context.md');
      const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      return newest ? await readFile(newest.file, 'utf-8') : '';
    } catch {
      return '';
    }
  }

  private async readBestPageContext(): Promise<string> {
    const [errorContext, domSnapshot] = await Promise.all([
      this.readLatestErrorContext(),
      this.readLatestDomSnapshot(),
    ]);

    return [
      errorContext,
      domSnapshot ? `\n\n--- DOM SNAPSHOT ---\n${domSnapshot}` : '',
    ].filter(Boolean).join('\n');
  }

  private async readLatestDomSnapshot(): Promise<string> {
    const healingDir = path.resolve('reports', 'healing');
    try {
      const files = await this.listFilesMatching(healingDir, /^dom-.*\.html$/i);
      const newest = files.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
      if (!newest) return '';
      const html = await readFile(newest.file, 'utf-8');
      return this.sanitizeHtml(html);
    } catch {
      return '';
    }
  }

  private sanitizeHtml(html: string): string {
    if (!html) return '';

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
    return cleaned.slice(0, 15_000);
  }

  private async listFilesByName(dir: string, fileName: string): Promise<Array<{ file: string; mtimeMs: number }>> {
    const entries = await readdir(dir);
    const files: Array<{ file: string; mtimeMs: number }> = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        files.push(...await this.listFilesByName(fullPath, fileName));
      } else if (entry === fileName) {
        files.push({ file: fullPath, mtimeMs: info.mtimeMs });
      }
    }

    return files;
  }

  private async listFilesMatching(dir: string, pattern: RegExp): Promise<Array<{ file: string; mtimeMs: number }>> {
    const entries = await readdir(dir);
    const files: Array<{ file: string; mtimeMs: number }> = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry);
      const info = await stat(fullPath);
      if (info.isDirectory()) {
        files.push(...await this.listFilesMatching(fullPath, pattern));
      } else if (pattern.test(entry)) {
        files.push({ file: fullPath, mtimeMs: info.mtimeMs });
      }
    }

    return files;
  }

  private inferTargetRequirement(failedSelector: string, pageContext: string, fallback: string): string {
    return fallback;
  }


  protected inferStableSelector(failedSelector: string, pageContext: string): string | undefined {
    return this.inferFromDomContext(failedSelector, pageContext);
  }

  /** Static convenience method used by CommonActions to get a fallback selector without needing an instance. */
  public static inferStableSelectorStatic(failedSelector: string, pageContext: string): string | undefined {
    const agent = new HealingAgent();
    // Using the protected method to perform inference.
    return agent.inferStableSelector(failedSelector, pageContext);
  }


  private inferFromDomContext(failedSelector: string, pageContext: string): string | undefined {
    if (!pageContext) return undefined;
    return this.inferStableSelectorFromDomElements(failedSelector, pageContext);
  }

  private inferStableSelectorFromDomElements(failedSelector: string, pageContext: string): string | undefined {
    const candidates = this.extractDomCandidates(pageContext);
    if (!candidates.length) return undefined;

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
      if (selector && this.normalizeSelector(selector) !== this.normalizeSelector(failedSelector)) return selector;
    }

    return undefined;
  }

  private extractDomCandidates(pageContext: string): DomElementCandidate[] {
    // Use Cheerio for robust DOM parsing first
    const cheerioCandidates = this.extractDomCandidatesWithCheerio(pageContext);
    // Fallback to regex‑based extraction for any remaining cases
    const regexCandidates = this.extractHtmlElementCandidates(pageContext);
    const ariaCandidates = this.extractAriaSnapshotCandidates(pageContext);
    // Combine and deduplicate by unique tag+attributes+text
    const all = [...cheerioCandidates, ...regexCandidates, ...ariaCandidates];
    const uniq = new Map<string, DomElementCandidate>();
    for (const c of all) {
      const key = `${c.tag}|${JSON.stringify(c.attributes)}|${c.text}`;
      if (!uniq.has(key)) uniq.set(key, c);
    }
    return Array.from(uniq.values());
  }

  /**
   * Parse the HTML using Cheerio and create stable element candidates.
   */
  private extractDomCandidatesWithCheerio(pageContext: string): DomElementCandidate[] {
    if (!pageContext) return [];
    const $ = cheerio.load(pageContext);
    const candidates: DomElementCandidate[] = [];
    const elements = $('*').toArray();
    elements.forEach((elem, idx) => {
      const tag = ((elem as any).tagName || (elem as any).name || '').toLowerCase();
      const attribs = (elem as any).attribs || {};
      const text = $(elem).text().trim();
      candidates.push(this.createDomCandidate(
        tag,
        this.normalizeAttributes(attribs),
        text,
        undefined,
        'html',
        idx,
      ));
    });
    return candidates;
  }

  /** Convert raw attribute map to lower‑cased string map */
  private normalizeAttributes(raw: Record<string, string | undefined>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v !== undefined && v !== null) out[k.toLowerCase()] = v;
    }
    return out;
  }

  private extractHtmlElementCandidates(pageContext: string): DomElementCandidate[] {
    return Array.from(pageContext.matchAll(/<(button|input|a|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1>|<(input)\b([^>]*)\/?>/gi))
      .map((match, index) => {
        const tag = (match[1] || match[4] || '').toLowerCase();
        const attributes = this.parseAttributes(match[2] || match[5] || '');
        const text = this.stripHtml(match[3] || '');
        return this.createDomCandidate(tag, attributes, text, undefined, 'html', index);
      });
  }

  private extractAriaSnapshotCandidates(pageContext: string): DomElementCandidate[] {
    const lines = pageContext.split(/\r?\n/);
    const candidates: DomElementCandidate[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = line.match(/^\s*-\s+(textbox|button|link|combobox|checkbox|radio|option|heading)\s*(?:"([^"]*)")?/i);
      if (!match) continue;

      const role = match[1].toLowerCase();
      const name = this.cleanAccessibleName(match[2] ?? '');
      const attributes: Record<string, string> = {};

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

  private createDomCandidate(
    tag: string,
    attributes: Record<string, string>,
    text: string,
    role: string | undefined,
    source: 'html' | 'aria',
    order: number
  ): DomElementCandidate {
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

  private tagForAriaRole(role: string): string {
    const tags: Record<string, string> = {
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

  private cleanAccessibleName(value: string): string {
    return value
      .replace(/\[[^\]]+\]$/g, '')
      .replace(/^[^\w@./#-]+|[^\w@./#-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private candidateMatchesSelectorIntent(candidate: DomElementCandidate, failedSelector: string): boolean {
    // Simple heuristic: ensure at least one significant word from the failed selector appears in the candidate's searchable text.
    const failedWords = this.significantWords(failedSelector);
    if (!failedWords.length) return true;
    const candidateText = candidate.searchText.toLowerCase();
    return failedWords.some(word => candidateText.includes(word));
  }

  private scoreDomCandidate(candidate: DomElementCandidate, failedSelector: string): number {
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

    if (candidate.source === 'html') score += 1;

    // Tag matching bonus
    const tagMatch = failedSelector.match(/^\/\/([a-zA-Z0-9*_-]+)/);
    if (tagMatch) {
      const failedTag = tagMatch[1].toLowerCase();
      if (failedTag === candidate.tag.toLowerCase()) {
        score += 10;
      }
    }

    return score;
  }

  private selectorForElement(candidate: DomElementCandidate): string | undefined {
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

    let visibleText = text.trim().replace(/\s+/g, ' ');
    visibleText = visibleText.replace(/\[SVG\]/gi, '').trim();

    // Fallback to text matching for short, single-line element text
    if (visibleText && visibleText.length < 60 && !visibleText.includes('\n') && !visibleText.includes(';')) {
      const cleanText = visibleText.replace(/'/g, "").trim();
      if (cleanText) {
        return `//${xpathTag}[contains(normalize-space(), '${cleanText}')]`;
      }
    }

    // If no stable attribute or text is found, rely on the LLM to provide the selector.
    return undefined;
  }

  private parseAttributes(rawAttributes: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    for (const match of rawAttributes.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
      attributes[match[1].toLowerCase()] = match[3];
    }
    return attributes;
  }

  private stripHtml(value: string): string {
    return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private significantWords(value: string): string[] {
    const stopWords = new Set(['locator', 'button', 'input', 'field', 'element', 'text', 'type', 'submit']);
    return (value.match(/[a-zA-Z0-9]+/g) ?? [])
      .map((word) => word.toLowerCase())
      .filter((word) => word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word));
  }

  private isDynamicValue(value: string): boolean {
    return /\b(\d{3,}|[a-f0-9]{8,}|react|mui|mat|headlessui|jss|css-|sc-)\b/i.test(value);
  }

  private escapeAttributeValue(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  private escapeCssIdentifier(value: string): string {
    return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
  }



  private isGenericSelector(selector: string): boolean {
    return /^(button|input|select|textarea)(\[type=["']?\w+["']?\])?$/.test(selector)
      || /^button:has-text\(["']add to cart["']\)$/i.test(selector)
      || selector === '*';
  }

  private async recordHistory(oldSelector: string, newSelector: string, file: string): Promise<void> {
    await ensureDir(path.dirname(this.historyPath));
    let history: any[] = [];
    try {
      const raw = await readFile(this.historyPath, 'utf-8');
      history = JSON.parse(raw);
    } catch {
      // file does not exist yet – start fresh
    }
    history.push({
      timestamp: new Date().toISOString(),
      file: path.basename(file),
      oldSelector,
      newSelector,
    });
    await writeFile(this.historyPath, JSON.stringify(history, null, 2));
  }
}
