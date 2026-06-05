# Security Policy

## Supported Versions

Only the latest release on the `main` branch receives security fixes.

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting feature:

1. Go to the **Security** tab of this repository
2. Click **Report a vulnerability**
3. Fill in the details — include steps to reproduce and potential impact

You will receive an acknowledgement within **48 hours** and a resolution or status update within **7 days**.

## Security Design

This project is a zero-dependency Node.js script. The security model is:

- **Secrets** (`ACCOUNTS_JSON`, `DISCORD_WEBHOOK_URL`) are stored as GitHub Actions Secrets and never logged.
- **Error messages** are sanitized via `sanitizeError()` before any logging — tokens, UUIDs, and URLs are redacted.
- **DRY_RUN defaults to `true`** — no deletions occur unless explicitly set to `false`.
- **All API calls** use a hard 30-second `AbortController` timeout (HK-15), including the Discord webhook.
- **Active/live resources** are excluded from deletion before any delete logic runs (HK-13).
- **Schema validation** runs before any API call is made (HK-03).
- **Per-account error isolation** means one failing account never blocks others (HK-11).

## Scope

In-scope for vulnerability reports:

- Logic that could cause unintended data deletion (e.g., bypassing `DRY_RUN`, deleting active deployments)
- Secret or token leakage through logs or error messages
- Configuration validation bypasses that could lead to unexpected behaviour
- Dependency or supply-chain issues in the GitHub Actions workflow

Out-of-scope:

- Issues requiring physical access to the runner
- Denial-of-service against external APIs (Cloudflare, GitHub) via rate-limiting edge cases
