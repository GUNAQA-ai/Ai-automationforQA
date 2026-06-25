"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrameworkError = void 0;
class FrameworkError extends Error {
    constructor(message, originalError, code = 'FRAMEWORK_ERROR') {
        super(message);
        this.name = 'FrameworkError';
        this.code = code;
        this.originalError = originalError;
        // Preserve proper stack trace (only works in V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FrameworkError);
        }
    }
}
exports.FrameworkError = FrameworkError;
//# sourceMappingURL=FrameworkError.js.map