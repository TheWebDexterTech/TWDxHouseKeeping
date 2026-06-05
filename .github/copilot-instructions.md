# Copilot Code Review Instructions — TWDxHouseKeeping

## What this repo does
This is a zero-dependency GitHub Action (Node.js ≥22) that cleans stale GitHub
deployments, workflow run history, and Cloudflare Pages/Workers deployments.
Main script: `src/cleanup.js`. Workflow: `.github/workflows/cleanup.yml`.

## Review priorities — flag these as errors:

### Security
- Any hardcoded tokens, API keys, secrets, or account IDs
- Any new `fetch()` call that doesn't check `res.ok` before using the response
- Any new `fetch()` call without an `AbortController` + `clearTimeout` timeout (HK-15: ALL fetch calls must timeout — including Discord webhook)
- Any deletion logic that runs without first checking `DRY_RUN === false`
- Any code that could delete the currently active/live deployment
- Missing `try/catch` around API calls (per-account isolation must be maintained)
- Any new numeric config field used without a type check in `validateConfig()` (HK-17 pattern)
- Any git repo string used without a `slashIdx > 0 && slashIdx < len-1` guard (HK-18)
- Any `commits[]` or similar array accessed at a dynamic index without a bounds/optional-chain check (HK-19)
- Any `fs.appendFileSync` / `writeFileSync` call without a surrounding `try/catch` (HK-20)
- Any new regex added to `sanitizeError()` that catches less than the existing patterns
- Any `JSON.parse` error message logged without passing through `sanitizeError()` (prevents secret fragments leaking from Node.js 22+ detailed parse errors)

### Logic
- `keep_count` being used without `keepCountFloor()` — minimum of 1 must be enforced
- Age filtering (`min_age_days`) being skipped or applied after slicing instead of before
- Any change to the concurrency group in `cleanup.yml`
- `DRY_RUN` default being changed from `'true'` to `'false'` in `cleanup.yml` without a comment

### Dependencies & versions
- This repo has zero npm dependencies by design — flag any `package.json` dependency additions
- Node.js built-ins and `fetch()` (native in Node 18+) are fine
- Any new GitHub Action added to `cleanup.yml` must use a pinned version tag
- `package.json` `engines.node` must stay `>=22.0.0` or higher

### Preflight integrity
- The CI preflight order in `cleanup.yml` must be: Validate environment → Syntax check → Lint → Test → Run cleanup
- Removing or reordering preflight steps is a flag

## Review priorities — flag these as warnings:
- Missing `console.log` for deleted items (all deletions must be traceable in logs)
- Discord embed fields exceeding 1024 characters without `.slice()`
- New parameters added to `ACCOUNTS_JSON` schema without `README` documentation
- New HK feature added without updating `DEVELOPER.md` section map, function index, and HK feature map

## Auto-approve signals (low risk):
- README-only changes
- Comment-only changes in `.js` files
- Version bumps in `cleanup.yml` from Dependabot
- `.gitignore` / `.claudeignore` additions
- `test/cleanup.test.js` changes that only add new test cases for existing functions
- `CHANGELOG.md` additions under `[Unreleased]`
- `.editorconfig`, `CONTRIBUTING.md`, issue template, or pull request template changes
- `DEVELOPER.md` line-number updates with no logic changes
