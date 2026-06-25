# AI‑Playwright‑Framework

## 📖 Project Overview

A **fully‑automated Playwright test generation framework** powered by AI agents. Users provide a high‑level JSON requirement (e.g. login, checkout) and the framework automatically:
1. **Plans** the test steps.
2. **Generates** page objects, locators, fixtures, test data, and test scripts.
3. **Executes** the Playwright test suite.
4. **Heals** failing locators on‑the‑fly.
5. **Reports** rich HTML/Allure artifacts (screenshots, videos, logs).

The code is written in **TypeScript** and runs on **Node.js**. All core utilities (common actions, logging, wait helpers) live under `framework/`. The AI‑driven agents live under `agents/`.

---

## 📂 Folder Structure

```
AI-PLAYWRIGHT-FRAMEWORK
│
├── package.json                # NPM metadata & scripts
├── package-lock.json           # Exact dependency versions
├── tsconfig.json               # TypeScript configuration
├── playwright.config.ts       # Playwright global config
├── .env                       # Global environment variables (user‑editable)
├── .gitignore                 # Ignored files (node_modules, generated, etc.)
│
├── requests/                   # ✏️ Primary user input (JSON requirement files)
│   ├── login-request.json
│   ├── registration-request.json
│   ├── checkout-request.json
│   └── search-product-request.json
│
├── agents/                     # 🤖 AI agents orchestrating the pipeline
│   ├── planning/               # PlanningAgent – creates a step plan
│   ├── generate/               # GenerateAgent – produces code artefacts
│   ├── execution/              # ExecutionAgent – runs Playwright
│   ├── healing/                # HealingAgent – self‑healing of locators
│   └── reporting/              # ReportingAgent – builds HTML/Allure reports
│
├── framework/                 # Core reusable library (POM, utils, wrappers)
│   ├── base/                  # BasePage and shared page utilities
│   ├── common/                # Common actions, logger, wait helpers
│   ├── fixtures/              # Global Playwright fixtures
│   └── utilities/             # Misc helpers (file, json, env loaders)
│
├── generated/                 # 🚀 Auto‑generated artefacts (do not edit manually)
│   ├── pages/                 # Page‑object classes
│   ├── locators/              # Locator definitions
│   ├── tests/                 # Playwright test files
│   ├── fixtures/              # Auto‑generated fixtures for tests
│   ├── assertions/            # Re‑usable verification helpers
│   └── test-data/             # JSON test data derived from requests
│
├── environments/              # 🌍 Per‑environment config files (git‑ignored)
│   ├── qa.env
│   ├── stage.env
│   └── prod.env
│
├── storage/                   # 📦 Persistent AI history & artefact snapshots
│   ├── plans/                 # Stored planning JSON files
│   ├── generated-tests/       # Snapshots of generated code per run
│   ├── locator-history.json
│   ├── healing-history.json
│   ├── execution-history.json
│   └── ai-memory.json
│
├── prompts/                   # Prompt templates used by the agents
│   ├── planning-prompt.txt
│   ├── generate-prompt.txt
│   ├── healing-prompt.txt
│   └── reporting-prompt.txt
│
├── reports/                   # 📊 Final artefacts for users
│   ├── html/                  # Human‑readable HTML report
│   ├── allure-results/        # Raw Allure data
│   ├── allure-report/         # Rendered Allure UI
│   ├── screenshots/           # Screenshots per test step
│   ├── videos/                # Test‑run videos
│   └── logs/                  # Console & agent logs
│
└── test-results/              # Raw Playwright test‑run output
    ├── traces/
    ├── videos/
    ├── screenshots/
    └── results.json
```

---

## ⚙️ Setup & Installation

1. **Clone the repo**
   ```bash
   git clone https://github.com/yourorg/AI-PLAYWRIGHT-FRAMEWORK.git
   cd AI-PLAYWRIGHT-FRAMEWORK
   ```
2. **Install Node dependencies**
   ```bash
   npm install
   ```
3. **Configure environments**
   - Edit `.env` for global variables (e.g., `BASE_URL`).
   - Add/modify `environments/qa.env`, `stage.env`, or `prod.env` with the credentials/URLs for each tier.
4. **(Optional) Add a `.env` entry for the AI service** (e.g., `GROQ_API_KEY`) if you want LLM‑based healing.

---

## 🚀 Running a Test (Typical Workflow)

1. **Create a requirement file** in `requests/` (JSON format). Example – `login-request.json`:
   ```json
   {
     "applicationUrl": "https://demo-app.com",
     "environment": "QA",
     "requirement": "Verify user can login successfully",
     "testData": { "username": "admin", "password": "admin123" }
   }
   ```
2. **Execute the pipeline** (single CLI command):
   ```bash
   npm run ai-test login-request.json
   ```
   This triggers all agents in order: Planning → Generation → Execution → Healing (if needed) → Reporting.
3. **Open the final report**:
   - HTML: `reports/html/index.html`
   - Allure UI: `reports/allure-report/index.html`
   Screenshots and videos are linked inside the reports.

---

## 🤖 Agent Details

| Agent | Directory | Core Responsibility |
|-------|-----------|----------------------|
| **PlanningAgent** | `agents/planning/PlanningAgent.ts` | Parses the JSON request, determines the high‑level scenario, and outputs a step‑by‑step plan saved to `storage/plans/<Scenario>Plan.json`. |
| **GenerateAgent** | `agents/generate/GenerateAgent.ts` | Consumes the plan, generates TypeScript page objects, locators, fixtures, test data, assertions, and the Playwright test file under `generated/`. |
| **ExecutionAgent** | `agents/execution/ExecutionAgent.ts` | Loads the generated test, injects the selected environment variables, runs `npx playwright test`, and captures artifacts. |
# 📦 Core Framework Utilities (framework)

- **BasePage** – Provides common page‑level helpers such as navigation and waiting for page loads. All generated pages extend this class.
- **CommonActions** – Thin wrappers around Playwright actions (`click`, `fill`, `press`, `waitForSelector`) that add structured logging, error handling, and automatic screenshots.
- **Logger** – Centralised logger located at `src/utils/logger.ts`. It writes coloured logs to the console and persists them in `reports/logs/`.
- **WaitHelpers** – Dynamic waiting utilities (explicit waits, fluent retries, auto‑retry) to minimise flakiness.
- **EnvLoader** – Reads the global `.env` and the selected `environments/*.env` files, exposing a typed configuration object for the agents.

---

## 🛠️ Customising & Extending

## 📋 Step‑by‑Step Task List

Below is a concise checklist you can follow in a single IDE. Execute each step before moving to the next.

- [ ] **Setup Project**
  1. Clone the repo.
  2. Run `npm ci` to install dependencies.
  3. Create a global `.env` with `BASE_URL` and `LLM_PROVIDER`.

- [ ] **Configure Environment**
  - Add `environments/qa.env`, `stage.env`, `prod.env` with credentials.
  - Ensure the appropriate API key (`GROQ_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`) is present.

- [ ] **Write Requirement JSON**
  - Place a file under `requests/` (e.g., `login-request.json`).

- [ ] **Run the AI Pipeline**
  - Execute `npm run ai-test <request>.json`.
  - Observe agents running in order: Planning → Generation → Execution → Healing (if needed) → Reporting.

- [ ] **Review Generated Code**
  - Inspect `generated/` for page objects, locators, and tests.
  - Promote stable files to `src/pages/` or `src/locators/` as needed.

- [ ] **Run Tests & View Reports**
  - Open `reports/html/index.html` or Allure UI (`reports/allure-report`).

- [ ] **Extend the Framework** *(optional)*
  - Add new agents under `agents/`.
  - Update CLI if needed.

- [ ] **Configure CI/CD**
  - Ensure GitHub Actions secrets are set.
  - Push changes to trigger the workflow.

- [ ] **Contribute**
  - Follow `CONTRIBUTING.md` guidelines, submit PRs.


## 🛡️ Robust Exception Handling & Logging

- **Centralised Logger** – use `src/utils/logger.ts` (winston) with log levels (`debug`, `info`, `warn`, `error`). All framework utilities call `Logger.getInstance().log(...)`.
- **Error Wrapper** – each public method in `BasePage`, `CommonActions` is wrapped in `try { … } catch (err) { Logger.error(...); throw new FrameworkError(message, err); }`.
- **FrameworkError** – custom error class extending `Error` with `code`, `originalError`, and stack‑trace preservation.
- **Automatic Screenshots** – on any caught exception within `CommonActions`, invoke `await this.page.screenshot({ path: `reports/screenshots/${Date.now()}.png` })`.
- **Retry‑With‑Heal** – `WaitHelpers.retryAsync(fn, attempts)` retries flaky actions; on final failure it triggers the HealingAgent.
- **User‑Friendly Messages** – logs include the page/component name, action description, and a short actionable hint (e.g., “Ensure the selector is correct or update the locator via the AI‑healing UI”).
- **Performance** – logger writes asynchronously; use `winston` transports to file and console without blocking test execution.
- **Customization** – adjust log format via the `LOG_FORMAT` env variable (e.g., `json`, `simple`).



1. **Promote stable code** – After reviewing a generated page or locator, copy it from `generated/` to a permanent location (e.g., `src/pages/`, `src/locators/`). Remove the autogenerated copy to keep `generated/` tidy for future runs.
2. **Add new agents** – Create a new sub‑folder under `agents/` and expose it via the CLI orchestrator if you need extra preprocessing such as API mocking or data seeding.
3. **Configure CI/CD** – The repo includes a GitHub Actions workflow (`.github/workflows/playwright.yml`) that runs `npm run ai-test <request>.json` on each push. Add your environment files as secrets.

## 🛠️ Tech Stack & Tools

| 🧩 Tool / Technology | 📦 Version* | ⭐ Purpose |
|----------------------|------------|-----------|
| **Node.js** | v18+ | Runtime for JavaScript/TypeScript |
| **npm** | v9+ | Package manager, script orchestration |
| **TypeScript** | v5.x | Statically typed source code, compiled to JS |
| **Playwright** | v1.45 | Cross‑browser automation & testing engine |
| **Playwright Test** | bundled with Playwright | Test runner, parallel execution, retries |
| **Allure‑Playwright** | v2.14 | Generates HTML Allure reports with screenshots & videos |
| **dotenv** | v16 | Loads `.env` and per‑environment `.env` files |
| **winston** | v3 | Structured logging (used via `src/utils/logger.ts`) |
| **fs‑extra** | v11 | Safe file system operations (JSON, artefacts) |
| **Groq API** *(optional)* | — | LLM service for self‑healing locator suggestions |
| **Git** | — | Version control for the repository |
| **GitHub Actions** | — | CI/CD workflow (`.github/workflows/playwright.yml`) |
| **Prettier** | v3 | Code formatting |
| **ESLint** | v8 | Linting for TypeScript |
| **PowerShell** | — | Helper scripts (`*.ps1`) for data generation |
| **Mermaid** (Markdown) | — | Diagram rendering in GitHub README (optional) |

*Versions are as defined in `package.json` at the time of writing.
---
---

## 📜 License

MIT License – feel free to use, modify, and distribute.

---

## 📞 Support / Contributions

- Open an issue on GitHub for bugs or feature requests.
- Fork the repo, create a feature branch, and submit a pull request.

---

## Real-World Agent Contract

The full pipeline is:

1. PlanningAgent
2. ApiAgent
3. GenerateAgent
4. SecurityAgent
5. ExecutionAgent
6. HealingAgent, only when execution exposes a healable selector failure
7. ReportingAgent

Existing generated files, stored plans, and precondition plans are preserved. New artifacts are written with collision-safe names.

### Request Shape

Use one request file for the full business flow: links, credentials, inputs, API setup, preconditions, locators, and UI steps.

```json
{
  "applicationUrl": "https://app.example.com",
  "apiBaseUrl": "https://api.example.com",
  "environment": "qa",
  "requirement": "Create a company by API, login, search the company in UI, and verify it is present.",
  "credentials": {
    "username": "${ENV:APP_USERNAME}",
    "password": "${ENV:APP_PASSWORD}"
  },
  "testData": {
    "companyName": "Acme Automation ${ENV:BUILD_ID}"
  },
  "apiRequests": [
    {
      "name": "createCompany",
      "method": "POST",
      "url": "/companies",
      "headers": {
        "Authorization": "Bearer ${ENV:API_TOKEN}"
      },
      "body": {
        "name": "${testData.companyName}"
      },
      "expectedStatus": 201,
      "extract": {
        "companyId": "$.id",
        "createdCompanyName": "$.name"
      }
    }
  ],
  "preconditions": [
    "Login with valid credentials"
  ],
  "locators": {
    "username": "#username",
    "password": "#password",
    "loginButton": "button[type='submit']",
    "companySearchInput": "[data-testid='company-search']",
    "companyResults": "[data-testid='company-results']"
  },
  "steps": [
    { "action": "fill", "target": "companySearchInput", "value": "${createdCompanyName}" },
    { "action": "assertText", "target": "companyResults", "value": "${createdCompanyName}" }
  ]
}
```

### Priority-Based Suites

For a full application flow, the request can contain multiple test cases. PlanningAgent creates/reuses one child plan per test case, then writes a suite/controller plan that runs them in priority/dependency order.

```json
{
  "applicationUrl": "https://app.example.com",
  "environment": "qa",
  "requirement": "Company module regression",
  "credentials": {
    "username": "${ENV:APP_USERNAME}",
    "password": "${ENV:APP_PASSWORD}"
  },
  "locators": {
    "username": "#username",
    "password": "#password",
    "loginButton": "button[type='submit']",
    "adminModule": "[data-testid='admin-module']",
    "companyMenu": "[data-testid='company-menu']",
    "addCompanyButton": "[data-testid='add-company']",
    "companyNameInput": "[data-testid='company-name']",
    "saveButton": "[data-testid='save']",
    "companySearchInput": "[data-testid='company-search']",
    "companyResults": "[data-testid='company-results']"
  },
  "testCases": [
    {
      "key": "login",
      "priority": 1,
      "requirement": "Login with valid credentials"
    },
    {
      "key": "openCompanyModule",
      "priority": 2,
      "dependsOn": ["login"],
      "requirement": "Open Admin module and Company menu",
      "steps": [
        { "action": "click", "target": "adminModule" },
        { "action": "click", "target": "companyMenu" }
      ]
    },
    {
      "key": "addCompany",
      "priority": 3,
      "dependsOn": ["login", "openCompanyModule"],
      "requirement": "Add company and verify it appears in search results",
      "testData": {
        "companyName": "Acme Automation"
      },
      "preconditions": [
        "Login with valid credentials",
        "Open Admin module and Company menu"
      ],
      "steps": [
        { "action": "click", "target": "addCompanyButton" },
        { "action": "fill", "target": "companyNameInput", "value": "Acme Automation" },
        { "action": "click", "target": "saveButton" },
        { "action": "fill", "target": "companySearchInput", "value": "Acme Automation" },
        { "action": "assertText", "target": "companyResults", "value": "Acme Automation" }
      ]
    }
  ]
}
```

Supported suite keys are `testCases`, `testcases`, `tests`, `scenarios`, and `flows`.

Planning behavior:

- `priority`, `order`, `sequence`, or `rank` controls execution order.
- `dependsOn` and `dependencies` keep dependent cases after required cases.
- Existing matching precondition plans are reused.
- Missing precondition plans are created.
- Inline precondition steps are prepended to the dependent test so browser state is available in that test.
- Suite/controller plans are not executed as empty tests; they only run child plans.

Conservative recovery behavior:

- If execution clearly fails because login, popup close, or module navigation setup was missing, the orchestrator updates the real plan once, regenerates, and retries.
- Recovery only applies when the needed credentials/locators are already available.
- Ambiguous failures remain normal failures and are reported; the framework does not guess unsafe flows.

### API Agent

ApiAgent reads API setup from `apiRequests`, `apis`, `api`, `endpoints`, `setup`, and precondition/dependency blocks.

It now:

- Executes API entries in order.
- Supports `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, and other HTTP methods.
- Resolves placeholders from env vars, credentials, test data, previous API responses, and extracted values.
- Validates `expectedStatus`.
- Extracts response values with simple JSON paths like `$.id` and `$.data.token`.
- Writes `reports/api/api-summary.json`.
- Writes shared state to `storage/api-state.json`.
- Fails the pipeline when a required API setup call fails.
- Masks secrets in reports.

Supported placeholders:

- `${ENV:API_TOKEN}`
- `${credentials.username}`
- `${testData.companyName}`
- `${companyId}`
- `${values.companyId}`
- `${api.createCompany.body.id}`

Set `"execute": false` on an API entry when you only want to document or normalize the API without calling it. Set `"optional": true` or `"continueOnFailure": true` when failure should be reported but should not stop the pipeline.

### Generate Agent

GenerateAgent reads `storage/api-state.json` before generation. If the API stage extracted values like `companyId`, `createdCompanyName`, `orderNumber`, or `token`, UI steps can use them through placeholders.

GenerateAgent also validates that generated code covers the full plan. If AI output only covers one part of a large E2E requirement, it is rejected and the structured plan-based generator is used.

### Security Agent

SecurityAgent scans the generated test import graph before execution.

It blocks critical issues:

- AI provider calls inside generated code.
- Shell or filesystem access from generated code.
- Dynamic JavaScript execution with `eval` or `new Function`.
- Hard-coded API keys, access tokens, or client secrets.
- Focused tests such as `test.only`.
- Raw Playwright page actions inside generated tests/page objects.
- Direct network calls from generated UI code; API setup must use ApiAgent.

It warns for maintainability issues:

- Generic generated method names.
- Fixed waits like `waitForTimeout`.
- Skipped generated tests.
- Fragile locator patterns such as absolute XPath or generated CSS classes.

Reports are written to `reports/security/security-summary.json`.

*End of README.*
