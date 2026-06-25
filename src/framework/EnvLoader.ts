import { Config } from './Config';

/**
 * EnvLoader – thin adapter around Config for backward-compatible access.
 * Use Config.get() directly in new code.
 */
export class EnvLoader {
  static get(key: string): string {
    return Config.get().get(key);
  }

  static getOptional(key: string, fallback?: string): string | undefined {
    return Config.get().getOptional(key, fallback);
  }
}
