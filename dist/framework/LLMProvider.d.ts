/**
 * Generic interface for LLM providers.
 */
export interface LLMProvider {
    /**
     * Send a prompt to the LLM and receive a response.
     * @param prompt The user prompt or system instruction.
     */
    generate(prompt: string): Promise<string>;
}
/**
 * Factory that returns the appropriate provider based on the `LLM_PROVIDER`
 * environment variable. Supported values: "groq", "openai", "ollama".
 */
export declare class LLMProviderFactory {
    private static logger;
    static getProvider(): LLMProvider;
    private static instantiateProvider;
}
//# sourceMappingURL=LLMProvider.d.ts.map