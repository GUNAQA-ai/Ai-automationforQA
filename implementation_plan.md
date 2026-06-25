# Implementation Plan: Environment Configurations & Build Optimization

The user requested updates to the environment configurations and an improvement to the `dist` folder, noting that it currently just unpleasantly mirrors the `src` directory structure.

## Proposed Changes

### 1. Update Environment Configurations (`environments/*.env`)
#### [MODIFY] `environments/qa.env`, `prod.env`, `stage.env`
- **AI Provider Routing**: Currently, the `.env` files just hold raw API keys. I will expand them to include the framework's AI routing flags (e.g., `LLM_PROVIDER=groq`, `GROQ_MODEL=llama-3.3-70b-versatile`, `OLLAMA_ENDPOINT=http://localhost:11434/api/generate`). This explicitly exposes the multi-model architecture so it can be tuned per environment.
- **Application Context**: Ensure `BASE_URL` and `ENVIRONMENT` tags are properly templated.

### 2. Improve the Build Process (`package.json` & `dist`)
#### [NEW] `esbuild` Bundler Integration
- The reason `dist` mirrors `src` is because the framework relies solely on the basic `tsc` compiler, which outputs 1:1 transpiled files.
- **Improvement**: I will install `esbuild` and update the `build` script in `package.json`. 
- Instead of a messy `dist/src` folder containing dozens of files, `esbuild` will bundle your entire AI CLI framework into a **single, minified `dist/cli.bundle.js`** file. 
- This will massively speed up framework boot times, eliminate the messy mirrored directory structure, and provide a single entry point for execution.

## User Review Required
Please review this plan. This will finalize your environment configurations and give you an elite, professional-grade build output (a single compiled artifact) rather than a messy source-mirrored output. If approved, I'll execute these changes.