# Changelog

All notable changes to TWDxHouseKeeping are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- HK-28: GitHub user repos now fetched via `GET /user/repos?visibility=all&affiliation=owner` (authenticated endpoint) instead of `GET /users/{username}/repos` (public-only) — private repositories were silently skipped during cleanup
- HK-29: `git_history_repos` is now optional — when omitted, the git history job falls back to the same repos already auto-discovered from `users`/`orgs`; explicit list still supported for targeted sweeps
- HK-21: Cloudflare Pages projects list no longer passes `page`/`per_page` query params — the endpoint does not accept them (CF error 8000024 "Invalid list options provided"), causing every Pages cleanup run to fail before inspecting any project
- HK-22: Cloudflare Workers cleanup now deletes entire scripts (`DELETE /workers/scripts/{id}`) rather than individual versions — the Workers API does not expose a version-level DELETE endpoint (HTTP 405 / CF error 10405 "Method not allowed for this authentication scheme")
- HK-23: Workers cleanup now checks `GET /workers/scripts/{id}/deployments` before deleting — any script with at least one version receiving >0% traffic is skipped, matching the active-deployment safeguard already in place for Pages (HK-13); defaults to "active/skip" if the deployment check itself fails
- HK-24: Pages eligible-deployment filter now excludes deployments with a non-empty `aliases` array — Cloudflare rejects DELETE on aliased deployments with error 8000035 ("You cannot delete an aliased deployment")
- HK-25: Workers DELETE is now wrapped in a per-worker try/catch — a binding restriction (e.g. Queue consumer, CF error 10064) or any other 4xx skips that script with a warning and continues processing remaining workers, rather than aborting the entire Workers block
- HK-26: Pages deployment DELETE is now wrapped in a per-deployment try/catch — handles the case where `aliases` is `null` in the list response (not caught by HK-24 filter) and any other 4xx, logging a warning and continuing rather than aborting the entire Pages block
- HK-27: Workers HK-23 deployment check now defaults to "active" when `result.versions` is empty or absent — Workers deployed via the old Upload API return no version data, which previously caused `isActive` to be `false` and the script to be attempted for deletion

## [1.1.0] — 2026-05-20

### Security
- HK-15: Added 30-second fetch timeout via `AbortController` to prevent stalled connections blocking the entire run
- HK-16: Extended `sanitizeError()` token redaction to cover provider prefixes: `ghp_`, `gho_`, `github_pat_`, `cf_`, `sk_`, `pk_`
- HK-17: `validateConfig()` now type-checks `keep_count` and `min_age_days` — non-number values are rejected at startup rather than silently corrupting age-gate comparisons at runtime
- HK-18: Added runtime guard for malformed `git_history_repos` entries where owner or repo is empty (e.g. `"owner/"`, `"/repo"`) — defence-in-depth layer on top of schema validation
- HK-19: Added optional-chaining bounds check before accessing `commits[keepHistoryCount]` in the history-trim path
- HK-20: Wrapped `appendFileSync` in `SummaryReport.write()` with try/catch so a disk-full or missing-path error cannot crash the run before the Discord notification fires

### Added
- Full unit test suite (`test/cleanup.test.js`) using Node.js built-in `node:test` + `assert` — 66 tests, zero external dependencies
- ESLint flat config (`eslint.config.mjs`) — zero additional dependencies, runs via `npx`
- Lint and test steps added to `cleanup.yml` — run before every cleanup execution
- `CONTRIBUTING.md` — local dev guide, PR process, safety invariants, HK-ID numbering
- Bug report and feature request issue templates (`.github/ISSUE_TEMPLATE/`)
- Pull request template with safety and documentation checklist
- `CHANGELOG.md` — this file
- `.editorconfig` — cross-editor whitespace normalisation
- Donation footer line added to GitHub Actions step summary

### Changed
- `README.md`: added CI/license/Node.js/zero-dep badges
- `README.md`: added architecture overview with ASCII diagram
- `README.md`: added missing `clean_git_history`, `git_history_repos`, `keep_history_count` rows to parameter table
- `README.md`: added troubleshooting section covering common HTTP errors and config mistakes
- `README.md`: upgraded donation section — corrected mislabelled Stripe link, added GitHub Sponsors, added star-the-repo CTA
- `FUNDING.yml`: added `github: thewebdexter`
- `validateConfig()`: stricter `git_history_repos` format check now rejects `"owner/"` and `"/repo"` at config time

## [1.0.0] — 2025-01-01

### Added
- Initial release
- HK-01: `DRY_RUN=true` default safety
- HK-03: `ACCOUNTS_JSON` schema validation
- HK-04: `keep_count` hard floor of 1
- HK-05: Concurrency guard in workflow
- HK-10: GitHub Actions step summary
- HK-11: Per-account error isolation
- HK-12: `min_age_days` age filter
- HK-13: Active deployment safeguard
- HK-14: Git history sweep with configurable `keep_history_count`
