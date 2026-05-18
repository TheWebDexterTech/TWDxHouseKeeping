# Copilot Code Review Instructions — TWDxHouseKeeping

## What this repo does
This is a zero-dependency GitHub Action (Node.js) that cleans stale GitHub 
deployments, workflow run history, and Cloudflare Pages/Workers deployments.
The main script is src/cleanup.js. The workflow is .github/workflows/cleanup.yml.

## Review priorities — flag these as errors:

### Security
- Any hardcoded tokens, API keys, secrets, or account IDs
- Any new fetch() call that doesn't check res.ok before using the response
- Any deletion logic that runs without first checking DRY_RUN === false
- Any code that could delete the currently active/live deployment
- Missing try/catch around API calls (per-account isolation must be maintained)

### Logic
- keep_count being used without keepCountFloor() — minimum of 1 must be enforced
- Age filtering (min_age_days) being skipped or applied after slicing instead of before
- Any change to the concurrency group in cleanup.yml
- DRY_RUN default being changed from 'true' to 'false' in cleanup.yml without a comment

### Dependencies
- This repo has zero npm dependencies by design — flag any package.json additions
- Node.js built-ins and fetch() (native in Node 18+) are fine
- Any new GitHub Action added to cleanup.yml must use a pinned version tag

## Review priorities — flag these as warnings:
- Missing console.log for deleted items (all deletions must be traceable in logs)
- Discord embed fields exceeding 1024 characters without .slice()
- New parameters added to ACCOUNTS_JSON schema without README documentation

## Auto-approve signals (low risk):
- README-only changes
- Comment-only changes in .js files
- Version bumps in cleanup.yml from Dependabot
- .gitignore additions
