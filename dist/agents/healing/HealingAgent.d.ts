/**
 * HealingAgent – when a locator fails, this agent calls the configured LLM
 * to suggest a more stable selector. It updates the locator file and logs
 * the healing action in storage/healing-history.json.
 */
export declare class HealingAgent {
    private readonly logger;
    private readonly historyPath;
    private readonly promptPath;
    run(locatorFile: string, failedSelector: string, pageHtmlSnippet?: string, targetRequirement?: string): Promise<string>;
    private findFileContainingSelector;
    private findCurrentRunLocatorFiles;
    private collectRelativeImportGraph;
    private getRelativeImportNames;
    private resolveRelativeImport;
    private tryApplyCodeHealing;
    private isStrictTextAssertionFailure;
    private findGeneratedPageFile;
    private extractPageFileFromLatestContext;
    private patchTextAssertionStrictMode;
    private listTypeScriptFiles;
    private cleanSelector;
    private normalizeSelector;
    private validateSelector;
    private guardHealedSelector;
    private contentHasSelector;
    private replaceSelector;
    private selectorReplacementPairs;
    private xpathAttributeQuoteVariants;
    private escapeForDoubleQuotedString;
    private escapeForSingleQuotedString;
    private escapeForTemplateString;
    private readLatestErrorContext;
    private readBestPageContext;
    private readLatestDomSnapshot;
    private sanitizeHtml;
    private listFilesByName;
    private listFilesMatching;
    private inferTargetRequirement;
    protected inferStableSelector(failedSelector: string, pageContext: string): string | undefined;
    /** Static convenience method used by CommonActions to get a fallback selector without needing an instance. */
    static inferStableSelectorStatic(failedSelector: string, pageContext: string): string | undefined;
    private inferFromDomContext;
    private inferStableSelectorFromDomElements;
    private extractDomCandidates;
    /**
     * Parse the HTML using Cheerio and create stable element candidates.
     */
    private extractDomCandidatesWithCheerio;
    /** Convert raw attribute map to lower‑cased string map */
    private normalizeAttributes;
    private extractHtmlElementCandidates;
    private extractAriaSnapshotCandidates;
    private createDomCandidate;
    private tagForAriaRole;
    private cleanAccessibleName;
    private candidateMatchesSelectorIntent;
    private scoreDomCandidate;
    private selectorForElement;
    private parseAttributes;
    private stripHtml;
    private significantWords;
    private isDynamicValue;
    private escapeAttributeValue;
    private escapeCssIdentifier;
    private isGenericSelector;
    private recordHistory;
}
//# sourceMappingURL=HealingAgent.d.ts.map