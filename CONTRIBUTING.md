# Contributing to TWDxHouseKeeping

Thank you for considering a contribution. This document explains how to get started, what the project expects, and how to get a PR merged.

---

## Philosophy

- **Zero npm dependencies** — always. Node.js built-ins and native `fetch` only. No `package.json` additions.
- **Safety invariants must never weaken.** See the list below — any PR that softens these will not be merged.
- **Dry-run first.** If your change affects deletion logic, test it in dry-run mode before pushing.

---

## Local Development

**Prerequisites:** Node.js 22+. No `npm install` needed.

### Run in dry-run mode locally

```bash
ACCOUNTS_JSON='{"cloudflare":[{"label":"test","token":"cf_fake","account_id":"abc123","clean_pages":true}]}' \
  DRY_RUN=true \
  node src/cleanup.js
```

### Run the test suite

```bash
NODE_ENV=test node --test test/cleanup.test.js
```

### Run the linter

```bash
npx eslint@9 src/cleanup.js
```

---

## Pull Request Process

1. **Open an issue first** for any non-trivial change so the approach can be agreed on before you invest time coding.
2. Fork the repository → branch from `main` → open a PR back to `main`.
3. All tests must pass: `NODE_ENV=test node --test test/cleanup.test.js`
4. Lint must pass: `npx eslint@9 src/cleanup.js`
5. Update `CHANGELOG.md` under `[Unreleased]` with a summary of your change.
6. If you add new `ACCOUNTS_JSON` parameters, update the parameter reference table in `README.md`.
7. If function locations in `src/cleanup.js` change significantly, update the Section Map and Function Index in `DEVELOPER.md`.

---

## Commit Message Format

```
feat: short description of the new feature
fix: short description of the bug fixed
docs: documentation-only change
test: test-only change
chore: maintenance (deps, CI, tooling)
```

---

## Safety Invariants — PRs That Break These Will Not Merge

| Invariant | Why it exists |
| --- | --- |
| Every DELETE/PATCH call must be wrapped in `if (!DRY_RUN)` | Prevents live deletions in preview runs |
| `keepCountFloor()` must be called before any `keep_count` comparison | Enforces the minimum-of-1 rule (HK-04) |
| Age filter must be applied **before** `.slice(keepCount)`, not after | Prevents deleting newer items first (HK-12) |
| Active/live deployments must be excluded **before** the slice | Preserves the currently serving deployment (HK-13) |
| Every account cleanup must be wrapped in a `try/catch` | Per-account error isolation — one failure can't stop others (HK-11) |
| Schema validation must complete before any API call | Catches config mistakes early (HK-03) |

---

## HK-ID Numbering

Every behaviour change or safety fix gets a HK-ID. The current highest is **HK-29**.

When adding a new one:
1. Assign `HK-30` (or the next available number).
2. Add it to the header comment block in `src/cleanup.js`.
3. Add it to the HK Feature Map table in `DEVELOPER.md`.
4. Document it in `CHANGELOG.md` under `[Unreleased]`.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.
