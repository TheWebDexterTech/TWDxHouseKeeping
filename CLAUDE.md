# TWDxHouseKeeping — Claude Index

## Architecture

One Node.js script (`src/cleanup.js`), zero npm dependencies. Runs as a GitHub Action
on a nightly schedule or manual trigger. Node.js ≥22 required (enforced by `package.json`
`engines` field and the `Validate environment` preflight step in `cleanup.yml`).

---

## File Map

| File | Purpose |
|---|---|
| `src/cleanup.js` | Entire implementation — 959 lines |
| `test/cleanup.test.js` | Unit tests — `node:test` + `assert`, 66+ cases, zero deps |
| `eslint.config.mjs` | Flat ESLint v9 config (ecmaVersion 2024) — no plugins, built-in rules only |
| `package.json` | Metadata, `engines: { node: ">=22" }`, `scripts.lint / test / start` |
| `.npmrc` | `fund=false` — suppresses telemetry in CI |
| `.github/workflows/cleanup.yml` | Schedule, env vars (`DRY_RUN`, `ACCOUNTS_JSON`, `DISCORD_WEBHOOK_URL`), concurrency guard, preflight steps |
| `.github/workflows/auto-merge.yml` | Dependabot auto-merge (patch/minor only); permissions scoped to job level |
| `.github/CODEOWNERS` | All changes require `@TheWebDexter` review; workflows directory explicitly listed |
| `.github/copilot-instructions.md` | Review contract: errors to flag, warnings, auto-approve signals |
| `.github/dependabot.yml` | Weekly `github-actions` ecosystem updates |
| `CONTRIBUTING.md` | Local dev guide, PR process, safety invariants, HK-ID numbering |
| `CHANGELOG.md` | Version history (Keep a Changelog format) |
| `SECURITY.md` | Supported versions, private disclosure process, security design invariants, scope |
| `.editorconfig` | Cross-editor whitespace normalisation |
| `.github/ISSUE_TEMPLATE/bug_report.yml` | Structured bug report form |
| `.github/ISSUE_TEMPLATE/feature_request.yml` | Feature request form with zero-dep constraint acknowledgement |
| `.github/pull_request_template.md` | PR safety and documentation checklist |

---

## Section Map (`src/cleanup.js`)

| Lines | Section |
|---|---|
| 1–24 | Header comment — HK fix log (HK-01 through HK-20) |
| 26–39 | Config & environment: `DRY_RUN` (l.26), `SUMMARY_FILE` (l.27), `sleep` (l.36), `API_TIMEOUT_MS` (l.39) |
| 41–57 | `apiFetch()` — fetch wrapper with `AbortController` hard timeout (HK-15) |
| 59–79 | `ageInDays()` (l.59), `keepCountFloor()` (l.63) |
| 81–92 | `sanitizeError()` — redacts tokens, UUIDs, URLs from error messages (HK-16) |
| 94–182 | `validateConfig()` — full ACCOUNTS_JSON schema validation (HK-03, HK-17, HK-18) |
| 184–254 | `SummaryReport` class — `.add()` l.190, `.addError()` l.194, `.write()` l.198 (HK-10, HK-20) |
| 258–387 | `sendDiscordNotification()` — Discord embed, color logic, `AbortController` timeout (HK-15) |
| 390–553 | `cleanCloudflare()` — Pages block l.406, Workers block l.478 |
| 556–886 | `cleanGitHub()` — repo fetch l.566, Deployments l.614, Actions l.685, Git history l.732 |
| 889–959 | `main()` — orchestration, per-account try/catch l.911/922, `module.exports` l.953 |

---

## Function Index

| Function | Line | One-liner |
|---|---|---|
| `sleep(ms)` | 36 | Promise delay for rate limiting |
| `apiFetch(url, options)` | 41 | `fetch()` wrapper with AbortController timeout + JSON parse |
| `ageInDays(dateStr)` | 59 | ISO date string → age in days |
| `keepCountFloor(val, label)` | 63 | Enforces keep_count minimum of 1 (HK-04) |
| `sanitizeError(err)` | 81 | Redacts tokens, UUIDs, URLs from error messages (HK-16) |
| `validateConfig(raw)` | 94 | Parses + validates full ACCOUNTS_JSON shape; uses `sanitizeError` on JSON.parse errors |
| `SummaryReport` | 184 | Class: `.add()` l.190, `.addError()` l.194, `.write()` l.198 |
| `sendDiscordNotification()` | 258 | Posts Discord embed; AbortController-protected fetch (HK-15) |
| `cleanCloudflare(acc, report)` | 390 | Cloudflare Pages + Workers cleanup |
| `cleanGitHub(acc, report)` | 556 | GitHub Deployments + Actions + Git history cleanup |
| `main()` | 889 | Entry point — validates config, orchestrates accounts, writes report |

---

## Key Constants

| Name | Line | Value |
|---|---|---|
| `DRY_RUN` | 26 | `true` (default — no deletes unless overridden) |
| `SUMMARY_FILE` | 27 | `process.env.GITHUB_STEP_SUMMARY` |
| `API_TIMEOUT_MS` | 39 | `30_000` — hard fetch timeout via AbortController (HK-15) |
| `SWEEP_MSG` | 735 | `"Swept clean by the TWDxHouseKeeping"` |
| CF pagination | 414, 433 | 25 items/page |
| GH pagination | 579, 598, 624, 694 | 100 items/page |

---

## Safety Invariants — Never Break These

- Every DELETE call is guarded by `if (!DRY_RUN)` — lines **456, 532, 654, 711, 779, 831**
- `keepCountFloor()` enforces keep ≥ 1 — HK-04 (line 63)
- Age filter applied **before** `.slice(keepCount)` — HK-12 (lines 450, 526, 648, 705)
- Active/live items excluded before any delete — HK-13 (lines 449, 647)
- Each account wrapped in try/catch — HK-11 (lines 911, 922)
- Schema validated before any API call — HK-03 (line 899)
- ALL fetch calls have AbortController timeout — HK-15 (apiFetch: l.43, Discord: l.364)
- JSON.parse errors in `validateConfig` pass through `sanitizeError` — prevents secret fragment leakage (line 101)

---

## HK Feature Map

| ID | Description | Location |
|---|---|---|
| HK-01 | DRY_RUN default true | `cleanup.js:26`, `cleanup.yml` env section |
| HK-03 | Schema validation before any API call | `cleanup.js:94` |
| HK-04 | keep_count floor=1 | `cleanup.js:63` |
| HK-05 | Concurrency guard | `cleanup.yml:18` |
| HK-10 | Step summary report | `cleanup.js:198` |
| HK-11 | Per-account error isolation | `cleanup.js:911,922` |
| HK-12 | min_age_days filter before slice | `cleanup.js:450,526,648,705` |
| HK-13 | Active deployment safeguard | `cleanup.js:449,647` |
| HK-14 | Git history sweep | `cleanup.js:732–883` |
| HK-15 | 30-second AbortController timeout on ALL fetch calls | `cleanup.js:39,43,364` |
| HK-16 | Token prefix redaction (ghp_, gho_, github_pat_, cf_, sk_, pk_) | `cleanup.js:87` |
| HK-17 | Type-check `keep_count` and `min_age_days` in `validateConfig` | `cleanup.js:120–125,137–142` |
| HK-18 | Runtime guard for malformed `owner/repo` strings | `cleanup.js:742–744` |
| HK-19 | Array bounds check for `commits[keepHistoryCount]` | `cleanup.js:820–821` |
| HK-20 | `try/catch` around `appendFileSync` in `SummaryReport.write` | `cleanup.js:233–239` |

---

## CI Preflight Steps (`cleanup.yml`)

Steps run in order before `node src/cleanup.js`:

1. **Validate environment** (l.58) — checks running Node.js satisfies `engines: ">=22"` from `package.json`
2. **Syntax check** (l.72) — `node --check` on both `src/cleanup.js` and `test/cleanup.test.js`
3. **Lint** (l.75) — `npx eslint@9 src/cleanup.js`
4. **Test** (l.78) — `NODE_ENV=test node --test test/cleanup.test.js`
5. **Run cleanup** (l.81) — `node src/cleanup.js`

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

Must contain at least one of `cloudflare` or `github` (validated at line 168).

---

## Adding New Features — Checklist

- Assign the next HK-ID and log it in `CONTRIBUTING.md` and the header comment in `src/cleanup.js`
- If a new config field is numeric: add type-check in `validateConfig` (HK-17 pattern)
- If a new `fetch()` call is added: wrap with `AbortController` + `clearTimeout` (HK-15)
- If a new DELETE is added: guard with `if (!DRY_RUN)` (HK-01)
- If a new `fs.writeFileSync`/`appendFileSync` is added: wrap in try/catch (HK-20)
- If a new array is indexed at a dynamic position: add bounds/optional-chain check (HK-19)
- Update section map, function index, and HK feature map in this file
- Update `CHANGELOG.md` under `[Unreleased]`
