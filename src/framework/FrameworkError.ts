export class FrameworkError extends Error {
  public readonly code: string;
  public readonly originalError?: Error;

  constructor(message: string, originalError?: Error, code = 'FRAMEWORK_ERROR') {
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
