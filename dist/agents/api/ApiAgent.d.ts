/**
 * ApiAgent executes API setup and API validation steps from request JSON.
 * It keeps API preconditions separate from UI generation while sharing extracted
 * response values through storage/api-state.json for later stages.
 */
export declare class ApiAgent {
    private readonly logger;
    private readonly reportsDir;
    private readonly generatedApiDir;
    private readonly apiStatePath;
    run(requestFile: string): Promise<string>;
    private parseRequest;
    private extractApiDefinitions;
    private extractApiDefinitionsFromValue;
    private flattenApiDefinitions;
    private hasEndpointShape;
    private normalizeApiDefinition;
    private resolveUrl;
    private normalizeHeaders;
    private normalizeAuthHeaders;
    private normalizeExpectedStatuses;
    private normalizeExtractMap;
    private executeApiDefinitions;
    private resolveApiDefinition;
    private executeApiDefinition;
    private skippedApiResult;
    private prepareRequestBody;
    private responseHeadersToObject;
    private parseResponseBody;
    private extractValues;
    private readJsonPath;
    private captureApiState;
    private resolveTemplatesInObject;
    private resolveTemplate;
    private lookupTemplateValue;
    private writeApiState;
    private writeGeneratedApiManifest;
    private maskSecrets;
    private isSecretKey;
    private uniquePath;
}
//# sourceMappingURL=ApiAgent.d.ts.map