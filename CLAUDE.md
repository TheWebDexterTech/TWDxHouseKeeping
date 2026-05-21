# TWDxHouseKeeping — Claude Index

## Architecture

One Node.js script, zero dependencies. All implementation lives in `src/cleanup.js`.
Runs as a GitHub Action on a nightly schedule or manual trigger.

---

## File Map

| File | Purpose |
|---|---|
| `src/cleanup.js` | Entire implementation — ~910 lines |
| `test/cleanup.test.js` | Unit tests — `node:test` + `assert`, 66 cases, zero deps |
| `eslint.config.mjs` | Flat ESLint v9 config — no plugins, built-in rules only |
| `.github/workflows/cleanup.yml` | Schedule, env vars (`DRY_RUN`, `ACCOUNTS_JSON`, `DISCORD_WEBHOOK_URL`), concurrency guard |
| `.github/copilot-instructions.md` | Review contract: errors to flag, warnings, auto-approve signals |
| `CONTRIBUTING.md` | Local dev guide, PR process, safety invariants, HK-ID numbering |
| `CHANGELOG.md` | Version history (Keep a Changelog format) |
| `.editorconfig` | Cross-editor whitespace normalisation |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Structured bug report form |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Feature request form with zero-dep constraint acknowledgement |
| `.github/pull_request_template.md` | PR safety and documentation checklist |

---

## Section Map (`src/cleanup.js`)

| Lines | Section |
|---|---|
| 1–14 | Header & HK fix log |
| 18–26 | Config & environment (`DRY_RUN`, `SUMMARY_FILE`) |
| 28–73 | Helpers (`sleep`, `apiFetch`, `ageInDays`, `keepCountFloor`, `sanitizeError`) |
| 75–144 | `validateConfig()` — ACCOUNTS_JSON schema validation |
| 146–195 | `SummaryReport` class — GitHub Actions step summary builder |
| 197–331 | `sendDiscordNotification()` — rich embed with color logic |
| 333–497 | `cleanCloudflare()` — Pages (351–420) + Workers (423–496) |
| 499–817 | `cleanGitHub()` — Deployments (559–627), Actions (630–674), Git history (677–816) |
| 819–887 | `main()` — orchestration, per-account error isolation, report writing |

---

## Function Index

| Function | Line | One-liner |
|---|---|---|
| `sleep(ms)` | 30 | Promise delay for rate limiting |
| `apiFetch(url, options)` | 32 | fetch() wrapper with error handling + JSON parse |
| `ageInDays(dateStr)` | 43 | ISO date string → age in days |
| `keepCountFloor(val, label)` | 47 | Enforces keep_count minimum of 1 (HK-04) |
| `sanitizeError(err)` | 65 | Redacts tokens, UUIDs, URLs from error messages (CodeQL) |
| `validateConfig(raw)` | 77 | Parses + validates full ACCOUNTS_JSON shape |
| `SummaryReport` | 149 | Class: `.add()` 154, `.addError()` 158, `.write()` 162 |
| `sendDiscordNotification()` | 211 | Posts embed to Discord webhook |
| `cleanCloudflare(acc, report)` | 335 | Cloudflare Pages + Workers cleanup |
| `cleanGitHub(acc, report)` | 501 | GitHub Deployments + Actions + Git history cleanup |
| `main()` | 821 | Entry point |

---

## Key Constants

| Name | Line | Value |
|---|---|---|
| `DRY_RUN` | 20 | `true` (default — no deletes unless overridden) |
| `SUMMARY_FILE` | 21 | `process.env.GITHUB_STEP_SUMMARY` |
| `API_TIMEOUT_MS` | 39 | `30_000` — hard fetch timeout via AbortController (HK-15) |
| `SWEEP_MSG` | ~695 | `"Swept clean by the TWDxHouseKeeping"` |
| keep_count floor | ~63–69 | Minimum 1 (never keep 0) |
| CF pagination | ~370, ~388 | 25 items/page |
| GH pagination | ~534, ~552, ~579, ~649 | 100 items/page |

---

## Safety Invariants — Never Break These

- Every DELETE call is guarded by `if (!DRY_RUN)` (lines 401, 477, 599, 656, 718, 763)
- `keepCountFloor()` enforces keep ≥ 1 — HK-04 (line 47)
- Age filter applied **before** `.slice(keepCount)` — HK-12 (lines 395, 471, 593, 650)
- Active/live items excluded before any delete — HK-13 (lines 391, 469, 581, 592)
- Each account wrapped in try/catch — HK-11 (line 842)
- Schema validated before any API call — HK-03 (line 823)

---

## HK Feature Map

| ID | Description | Location |
|---|---|---|
| HK-01 | DRY_RUN default true | `cleanup.js:20`, `cleanup.yml:35` |
| HK-03 | Schema validation | `cleanup.js:77` |
| HK-04 | keep_count floor=1 | `cleanup.js:47` |
| HK-05 | Concurrency guard | `cleanup.yml:18` |
| HK-10 | Step summary report | `cleanup.js:162` |
| HK-11 | Per-account error isolation | `cleanup.js:842` |
| HK-12 | min_age_days filter | `cleanup.js:395,471,593,650` |
| HK-13 | Active deployment safeguard | `cleanup.js:391,469,581,592` |
| HK-14 | Git history sweep | `cleanup.js:677–816` |
| HK-15 | 30-second fetch timeout via AbortController | `cleanup.js:39,41–49` |
| HK-16 | Extended token prefix redaction (ghp_, gho_, github_pat_, cf_, sk_, pk_) | `cleanup.js:86` |
| HK-17 | Type-check `keep_count` and `min_age_days` in `validateConfig` | `cleanup.js:121–126,139–144` |
| HK-18 | Runtime guard for malformed `owner/repo` strings in `git_history_repos` | `cleanup.js:~700–707` |
| HK-19 | Array bounds check for `commits[keepHistoryCount]` in trim path | `cleanup.js:~768–775` |
| HK-20 | `try/catch` around `appendFileSync` in `SummaryReport.write` | `cleanup.js:~203–209` |

---

## Config Schema (ACCOUNTS_JSON)

```json
{
  "cloudflare": [{
    "token": "required",
    "account_id": "required",
    "label": "required",
    "clean_pages": "bool (optional)",
    "clean_workers": "bool (optional)",
    "keep_count": "int ≥1 (optional, default 1)",
    "min_age_days": "number (optional, default 0)"
  }],
  "github": [{
    "token": "required",
    "label": "required",
    "users": "string[] (optional)",
    "orgs": "string[] (optional)",
    "clean_deployments": "bool (optional)",
    "clean_actions": "bool (optional)",
    "clean_git_history": "bool (optional)",
    "git_history_repos": "string[] — required if clean_git_history=true, format 'owner/repo'",
    "keep_history_count": "int ≥0 (optional, default 0 = full sweep)",
    "keep_count": "int ≥1 (optional, default 1)",
    "min_age_days": "number (optional, default 0)"
  }]
}
```

Must contain at least one of `cloudflare` or `github` (validated at line 132).
