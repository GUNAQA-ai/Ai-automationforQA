"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvLoader = void 0;
const Config_1 = require("./Config");
/**
 * EnvLoader – thin adapter around Config for backward-compatible access.
 * Use Config.get() directly in new code.
 */
class EnvLoader {
    static get(key) {
        return Config_1.Config.get().get(key);
    }
    static getOptional(key, fallback) {
        return Config_1.Config.get().getOptional(key, fallback);
    }
}
exports.EnvLoader = EnvLoader;
//# sourceMappingURL=EnvLoader.js.map