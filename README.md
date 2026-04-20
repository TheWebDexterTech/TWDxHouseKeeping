# 🧹 TWDxHouseKeeping Tools
**Developed by:** [TheWebDexter](https://www.TheWebDexter.com)

A powerful, zero-dependency GitHub Action that automates deep housekeeping across your development stack. Keep only what you need and wipe the rest.

## 🛠️ Features
- **GitHub Cleanup:** Delete old deployments and purge massive Action history.
- **Cloudflare Cleanup:** Shred stale Pages deployments and Worker history.
- **Granular Control:** Choose what to clean and how much to keep per account.
- **Rate-Limit Safe:** Intelligent throttling to avoid API bans.

## 🚀 Setup

### 1. Add the Script
Create `.github/workflows/cleanup.yml` and `src/cleanup.js` in your repository.

### 2. Configure the Secret
Add a Repository Secret named `ACCOUNTS_JSON`. 

### 3. Configuration Schema
Each account block in your JSON supports these granular flags:

| Key | Description | Default |
| :--- | :--- | :--- |
| `keep_count` | Number of recent items to preserve | `1` |
| **GitHub Flags** | | |
| `clean_deployments`| Delete stale repo deployments | `false` |
| `clean_actions` | Purge workflow run history | `false` |
| **Cloudflare Flags** | | |
| `clean_workers` | Delete old Worker deployments | `false` |
| `clean_pages` | Delete old Pages deployments | `false` |

---

## ⏰ Scheduling & Testing
The schedule is defined in `.github/workflows/cleanup.yml`.

### Testing Phase (Recommended)
To test the tool for one week, we recommend running it once every hour to see immediate results without being aggressive. 
Change your cron line to:
`cron: '0 * * * *'`

### Production Phase
Once you are happy with the results, move to a nightly cycle to save GitHub Action minutes:
`cron: '0 0 * * *'` (Every night at Midnight)
