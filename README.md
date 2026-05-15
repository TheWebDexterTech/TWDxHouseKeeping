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

### 4. JSON Configuration Example
Copy, modify, and paste this exact structure into your `ACCOUNTS_JSON` secret:

```json
{
  "cloudflare": [
    {
      "label": "Personal Cloudflare",
      "token": "YOUR_CF_API_TOKEN",
      "account_id": "YOUR_CF_ACCOUNT_ID",
      "keep_count": 3,
      "clean_workers": true,
      "clean_versions": false,
      "clean_pages": true
    }
  ],
  "github": [
    {
      "label": "Personal GitHub",
      "token": "YOUR_GH_PAT",
      "users": ["your-github-username"],
      "orgs": ["your-organization-name"],
      "keep_count": 5,
      "clean_deployments": true,
      "clean_actions": true
    }
  ]
}

```

## ⏰ Scheduling & Testing

The schedule is defined in `.github/workflows/cleanup.yml`.

### Testing Phase (Recommended)

To test the tool for one week, we recommend running it once every hour to see immediate results without being aggressive.
Change your cron line to:
`cron: '0 * * * *'`

### Production Phase

Once you are happy with the results, move to a nightly cycle to save GitHub Action minutes:
`cron: '0 0 * * *'` (Every night at Midnight)

---

## 🤝 Contributing

Contributions, issues, and feature requests are highly encouraged!
Feel free to fork this repository, make your changes, and open a Pull Request. If you plan on making major changes, please open an issue first to discuss what you would like to change.

## ☕ Support & Donate

If this tool has helped you save time, server costs, or GitHub Action minutes, please consider supporting the project! Your contributions help keep these tools free, maintained, and updated.

* [Sponsor on GitHub](https://buy.stripe.com/7sY5kDaZx1ixbcS5gCc7u00)
