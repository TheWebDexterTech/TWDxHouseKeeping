# 🧹 TWDxHouseKeeping Tools
**Developed by:** [TheWebDexter](https://www.TheWebDexter.com)

A pure GitHub Action that runs automatically to strictly enforce a **"Keep Only 1"** deployment policy across your GitHub and Cloudflare accounts. It deletes all abandoned preview environments, stale Pages deployments, and Worker history to keep your limits low and your dashboards clean.

## 🚀 Setup Guide

### Step 1: Generate API Tokens
**GitHub:**
1. Go to **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Click **Generate new token**.
3. **Repository access:** `All repositories`.
4. **Permissions needed:** Deployments (Read & Write), Contents (Read & Write), Pull requests (Read-only), Metadata (Read-only).
5. Copy the generated `ghp_...` token.

**Cloudflare:**
1. Go to Cloudflare Dashboard **→ My Profile → API Tokens**.
2. Click **Create Token** → **Custom Token**.
3. **Permissions needed:** `Account` → `Cloudflare Pages` (Edit), `Workers Scripts` (Edit), `Account Settings` (Read).
4. Copy the generated token. (Grab your **Account ID** from the right-hand sidebar of your dashboard while you are there).

### Step 2: Configure Your Repository
1. In your GitHub repository, go to **Settings → Secrets and variables → Actions → New repository secret**.
2. **Name:** `ACCOUNTS_JSON`
3. **Secret:** Paste your configuration in the exact format below, using the tokens you just generated:

```json
{
  "github": [
    {
      "label": "My Dev Profile",
      "token": "ghp_YOUR_NEW_GITHUB_TOKEN",
      "orgs":  ["TheWebDexterTech"],
      "users": ["thewebdexter"]
    }
  ],
  "cloudflare": [
    {
      "label":      "Main Account",
      "token":      "YOUR_NEW_CF_API_TOKEN",
      "account_id": "YOUR_CF_ACCOUNT_ID"
    }
  ]
}
