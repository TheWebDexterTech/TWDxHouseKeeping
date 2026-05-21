# Changelog

All notable changes to TWDxHouseKeeping are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
