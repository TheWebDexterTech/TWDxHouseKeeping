# 🧹 TWDxHouseKeeping

**Developed by:** [TheWebDexter](https://www.TheWebDexter.com)

[![CI](https://github.com/TheWebDexterTech/TWDxHouseKeeping/actions/workflows/cleanup.yml/badge.svg)](https://github.com/TheWebDexterTech/TWDxHouseKeeping/actions/workflows/cleanup.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)](src/cleanup.js)

A powerful, zero-dependency GitHub Action that automates deep housekeeping across your development stack. Keep only what you need and wipe the rest — safely, with a dry-run preview built in.

---

## 🛠️ Features

- **GitHub Cleanup:** Delete stale deployments and purge old workflow run history.
- **Cloudflare Cleanup:** Remove old Pages deployments and Worker version history.
- **Granular Control:** Choose what to clean, how much to keep, and a minimum age per account.
- **Dry-Run by Default:** Preview exactly what would be deleted before anything is touched.
- **Rate-Limit Safe:** Intelligent throttling to avoid API bans.
- **Live Deployment Guard:** Never deletes your currently active/live deployment.
- **Per-Account Isolation:** One bad token won't stop cleanup of your other accounts.
- **Step Summary Report:** Every run writes a clean markdown table to the GitHub Actions job summary.

---

## 🏗️ Architecture

One Node.js script, zero npm dependencies. Copy two files into your repo, add a secret, and the nightly schedule handles the rest.

```
┌─────────────────────────────────────────────────────────────┐
│              GitHub Actions  (cleanup.yml)                   │
│   Schedule: nightly cron  │  Manual: workflow_dispatch       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                      src/cleanup.js                          │
│                                                              │
│  validateConfig()  ──▶  ACCOUNTS_JSON schema check           │
│        │                                                     │
│        ▼                                                     │
│  cleanCloudflare()  ──▶  CF API  (Pages, Workers)            │
│  cleanGitHub()      ──▶  GH API  (Deployments, Actions,      │
│                                   Git History)               │
│        │                                                     │
│        ▼                                                     │
│  SummaryReport.write()        ──▶  GITHUB_STEP_SUMMARY       │
│  sendDiscordNotification()    ──▶  Discord Webhook           │
└─────────────────────────────────────────────────────────────┘

Safety stack (applied in order, never bypassed):
  DRY_RUN guard → keepCountFloor → age filter → active exclusion → per-account try/catch
```

---

## 🚀 Setup

### 1. Copy the files into your repository

Copy these two files from this repo into your own repository at the same paths:

```
src/cleanup.js
.github/workflows/cleanup.yml
```

### 2. Create the required secret

Go to your repository → **Settings → Secrets and variables → Actions → New repository secret**.

Create a secret named exactly: `ACCOUNTS_JSON`

Paste your configuration JSON as the value (see schema below).

### 3. Minimum required token permissions

> ⚠️ **Always use the minimum permissions needed. Never use a Global API Key or a full-scope PAT.**

**GitHub — Fine-Grained Personal Access Token (recommended)**

Go to [github.com/settings/tokens](https://github.com/settings/tokens) → Generate new token (fine-grained).

Select only the repositories this tool should clean, then grant:
| Permission | Level |
| --- | --- |
| Actions | Read and Write |
| Deployments | Read and Write |
| Metadata | Read (auto-selected) |

Do **not** grant admin, contents write, secrets, or org-level permissions.

**Cloudflare — API Token (not the Global API Key)**

Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Custom Token.

Grant only:
| Permission | Level |
| --- | --- |
| Account → Cloudflare Pages | Edit |
| Account → Workers Scripts | Edit |

Scope it to only the specific account you intend to clean.

---

### 4. Configuration schema

Paste this structure into your `ACCOUNTS_JSON` secret. Remove the sections you don't need.

```json
{
  "cloudflare": [
    {
      "label": "My Cloudflare Account",
      "token": "YOUR_CF_API_TOKEN",
      "account_id": "YOUR_CF_ACCOUNT_ID",
      "keep_count": 3,
      "min_age_days": 7,
      "clean_workers": true,
      "clean_pages": true
    }
  ],
  "github": [
    {
      "label": "My GitHub Account",
      "token": "YOUR_GH_FINE_GRAINED_PAT",
      "users": ["your-github-username"],
      "orgs": ["your-organization-name"],
      "keep_count": 5,
      "min_age_days": 3,
      "clean_deployments": true,
      "clean_actions": true
    }
  ]
}
```

**Full parameter reference:**

| Key | Applies to | Description | Default |
| --- | --- | --- | --- |
| `label` | Both | Display name used in logs and the job summary | **Required** |
| `token` | Both | API token (see permissions section above) | **Required** |
| `account_id` | Cloudflare | Your Cloudflare account ID | **Required** |
| `users` | GitHub | List of GitHub usernames whose repos to clean | — |
| `orgs` | GitHub | List of GitHub org names whose repos to clean | — |
| `keep_count` | Both | Number of recent items to keep **per workflow** (Actions), **per environment** (Deployments), and **per project** (Pages). Set to `0` to delete everything non-active. | `1` |
| `min_age_days` | Both | Only delete items older than this many days. Protects recent deployments. | `0` |
| `clean_deployments` | GitHub | Delete stale repo deployments | `false` |
| `clean_actions` | GitHub | Delete completed workflow run history | `false` |
| `clean_workers` | Cloudflare | Delete old Worker version history | `false` |
| `clean_pages` | Cloudflare | Delete old Pages deployment history | `false` |
| `clean_git_history` | GitHub | Squash or wipe git commit history for specified repos | `false` |
| `git_history_repos` | GitHub | Repos to rewrite history on, format `"owner/repo"`. Optional — if omitted, repos are auto-discovered from the users/orgs arrays. | — |
| `keep_history_count` | GitHub | Number of recent commits to preserve. `0` = full orphan wipe (single commit carrying current tree) | `0` |

> **Note:** `keep_count: 0` is valid and means delete everything non-active — all completed workflow runs are deleted, all non-active/non-aliased deployments are deleted. The currently active/live deployment is always preserved regardless of `keep_count`. `keep_count` is applied independently per workflow (for Actions) and per environment (for Deployments and Pages), so setting `1` keeps exactly one entry per workflow/environment — not one across the entire repo.

---

## 🔍 Dry-Run Mode (default: ON)

**Dry-run is enabled by default.** The script will log everything it would delete without making a single API call to delete anything. This is intentional — deletion is irreversible.

**To do a preview run manually:**
Go to your repository → **Actions → TWDxHouseKeeping → Run workflow** → choose `dry_run: true`.

**To do a real deletion run manually:**
Go to **Actions → TWDxHouseKeeping → Run workflow** → choose `dry_run: false`.

**To enable real deletions on the schedule:**
In `.github/workflows/cleanup.yml`, find this line:

```yaml
DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || 'true' }}
```

Change it to:

```yaml
DRY_RUN: "false"
```

---

## ⏰ Scheduling

The template ships with only the manual `workflow_dispatch` trigger. Add a schedule once you've verified your config with a dry run.

**Recommended workflow:**

1. Start with a manual dry run to review what would be deleted.
2. Run manually with `dry_run: false` once you're satisfied.
3. Add the schedule below to `.github/workflows/cleanup.yml` under the `on:` block for automated nightly cleanup.

```yaml
on:
  schedule:
    - cron: "0 0 * * *"   # Every night at midnight UTC
  workflow_dispatch:
```

| Phase | Cron | Description |
| --- | --- | --- |
| Testing | `0 * * * *` | Every hour — see results fast |
| Production | `0 0 * * *` | Every night at midnight UTC |

---

## 📋 Job Summary

After each run, a markdown report is written to the GitHub Actions job summary. Click any run in the Actions tab to see exactly what was deleted (or would be deleted in dry-run mode) per account, per platform, per type — with a count of items deleted and items kept.

---

## 📣 Discord Notifications (Optional)

After every run — scheduled or manual, dry or live — TWDxHouseKeeping can post a rich summary embed to a Discord channel.

**What the embed shows:**
- ✅ / ⚠️ / 🔍 run status and mode (dry run vs live)
- Per-account breakdown: what was deleted and what was kept
- Total deleted and skipped counts
- Any errors per account and platform
- Direct link to the GitHub Actions run log

**Embed colours:**

| Colour | Meaning |
| --- | --- |
| 🟣 Blurple | Dry run — nothing changed |
| 🟢 Green | Live run — items deleted successfully |
| 🟡 Yellow | Live run — nothing to clean |
| 🔴 Red | One or more accounts had errors |

**Setup — one step:**

1. Go to your Discord channel → **Edit Channel → Integrations → Webhooks → New Webhook**. Copy the webhook URL.
2. Go to your repository → **Settings → Secrets and variables → Actions → New repository secret**.
3. Name the secret `DISCORD_WEBHOOK_URL` and paste the webhook URL as the value.

That's it. The workflow already reads this secret. If the secret is not set, notifications are silently skipped — nothing breaks.

---

## 🔧 Troubleshooting

**"ACCOUNTS_JSON is not valid JSON"**
Run your JSON through [jsonlint.com](https://jsonlint.com). Common causes: trailing commas, unquoted keys, or smart quotes copy-pasted from documentation.

**HTTP 403 on Cloudflare**
Your token is missing `Account → Cloudflare Pages: Edit` or `Workers Scripts: Edit`. Check that the token is scoped to the correct account ID.

**HTTP 403 on GitHub**
Your fine-grained PAT needs `Actions: Read and Write` and `Deployments: Read and Write`. Confirm you selected the correct repositories in the token scope.

**HTTP 401 on either platform**
The token has expired or been revoked. Rotate it and update the `ACCOUNTS_JSON` secret.

**Run finished but nothing was deleted**
1. Check `min_age_days` — items younger than this are skipped.
2. Check `keep_count` — if you have exactly that many items per workflow/environment, nothing qualifies. Set to `0` to delete all non-active items.
3. Confirm `DRY_RUN=false` is set for scheduled runs if you want live deletions.

**Discord notification not arriving**
Confirm `DISCORD_WEBHOOK_URL` is a repository secret (not a hardcoded value in the YAML). The value must start with `https://discord.com/api/webhooks/`.

**Git history sweep ran but commits are still visible locally**
The sweep force-updates the remote branch ref. Local clones that ran `git fetch` before the sweep need `git pull --rebase` or a fresh clone. The GitHub web UI reflects the new history immediately.

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR — it covers local dev setup, the safety invariants that must never be weakened, and the PR checklist.

---

## 💛 Support This Project

TWDxHouseKeeping is free, open-source, and maintained in spare time. If it saves you GitHub Action minutes, server costs, or the mental overhead of manual cleanup — consider giving something back.

Every contribution directly funds continued maintenance, new platform support, and keeping the zero-dependency policy intact.

- **[Sponsor on GitHub Sponsors](https://github.com/sponsors/thewebdexter)** — recurring or one-time, managed by GitHub
- **[One-time via Stripe](https://buy.stripe.com/7sY5kDaZx1ixbcS5gCc7u00)** — no account needed

If sponsoring isn't for you right now: **⭐ starring the repository** helps more people discover the project and is genuinely appreciated.

> You don't owe this project anything. But if it's been useful, it's nice to say so.

---

## 📄 License

MIT
