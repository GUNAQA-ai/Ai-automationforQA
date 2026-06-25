/**
 * EnvLoader – thin adapter around Config for backward-compatible access.
 * Use Config.get() directly in new code.
 */
export declare class EnvLoader {
    static get(key: string): string;
    static getOptional(key: string, fallback?: string): string | undefined;
}
//# sourceMappingURL=EnvLoader.d.ts.map