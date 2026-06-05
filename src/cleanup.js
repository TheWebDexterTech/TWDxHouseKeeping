/**
 * TWDxHouseKeeping — cleanup.js
 * Developed by TheWebDexter.com
 *
 * Fixes applied:
 *   HK-01 — Dry-run mode (DRY_RUN=true by default for safety)
 *   HK-03 — Full ACCOUNTS_JSON schema validation with clear errors
 *   HK-04 — keep_count floor of 0 (0 = delete-all mode; invalid/negative values default to 1)
 *   HK-10 — GitHub Actions Step Summary report
 *   HK-11 — Per-account error isolation (one failure doesn't stop others)
 *   HK-12 — min_age_days filter (skip items newer than N days)
 *   HK-13 — Live/active deployment safeguard (never delete the active one)
 *   HK-14 — Git history sweep with configurable keep_history_count (0 = full orphan wipe)
 *   HK-15 — 30-second fetch timeout via AbortController (prevents hung connections)
 *   HK-16 — Extended token prefix redaction (ghp_, gho_, github_pat_, cf_, sk_, pk_)
 *   HK-17 — Type-check keep_count and min_age_days in validateConfig
 *   HK-18 — Runtime guard for malformed "owner/repo" git_history_repos entries
 *   HK-19 — Array bounds check for commits[keepHistoryCount] in trim path
 *   HK-20 — try/catch around appendFileSync in SummaryReport.write
 *   HK-21 — Pages projects list: removed unsupported page/per_page params (CF error 8000024)
 *   HK-22 — Workers cleanup: delete entire scripts via DELETE /scripts/{id} (version DELETE not supported by API)
 *   HK-23 — Workers active-deployment guard: check /deployments before deleting; skip any script with >0% traffic
 *   HK-24 — Pages aliased-deployment guard: filter out deployments with aliases before eligible slice (CF error 8000035)
 *   HK-25 — Workers per-worker error isolation: DELETE failures skip that script and continue rather than aborting the block
 *   HK-26 — Pages per-deployment isolation: DELETE failures skip that deployment and continue (handles aliases not in list response)
 *   HK-27 — Workers HK-23 safe default: empty/null deployment versions treated as active so old-Upload-API workers are never deleted
 *   HK-28 — User repos: use /user/repos (authenticated) instead of /users/{u}/repos (public-only) so private repos are cleaned
 *   HK-29 — Git history auto-discovery: if git_history_repos is omitted, fall back to repos already discovered from users/orgs
 *   HK-30 — Actions keep_count per workflow: group runs by workflow_id before slice so each workflow retains N runs independently
 *   HK-31 — Deployments keep_count per environment: group by environment before slice so each environment retains N deployments independently
 */

"use strict";

const fs = require("node:fs");

// ── Config & Environment ──────────────────────────────────────────────────────

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY ?? null;

if (DRY_RUN) {
  console.log("🔍  DRY-RUN MODE — no deletions will be made");
  console.log("    Set DRY_RUN=false in your workflow env to run for real.\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// HK-15: Hard timeout for every outbound fetch — prevents hung connections
const API_TIMEOUT_MS = 30_000;

async function apiFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 204) {return null;}
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} — ${url}\n${body}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  return ct.includes("application/json") ? res.json() : null;
}

function ageInDays(dateStr) {
  return (Date.now() - new Date(dateStr).getTime()) / 86_400_000;
}

function keepCountFloor(val, label) {
  const n = parseInt(val ?? 1, 10);
  if (isNaN(n) || n < 0) {
    console.warn(`  ⚠️  keep_count for "${label}" is invalid — defaulting to 1`);
    return 1;
  }
  return n;
}

// Truncates and redacts tokens/UUIDs/URLs — API error bodies can echo partial credentials (CodeQL js/clear-text-logging).
function sanitizeError(err) {
  if (!err) {return "unknown error";}
  return String(err.message ?? err)
    .slice(0, 300)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(ghp_|gho_|github_pat_|cf_|sk_|pk_)[A-Za-z0-9_\-]{4,}/g, "[REDACTED]")
    .replace(/[A-Za-z0-9+/]{32,}={0,2}/g, "[REDACTED]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "[ID]")
    .replace(/https?:\/\/\S+/g, "[URL]");
}

// ── Schema Validation ─────────────────────────────────────────────────────────

function validateConfig(raw) {
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `ACCOUNTS_JSON is not valid JSON.\n` +
      `Parse error: ${sanitizeError(e)}\n` +
      `Tip: Use https://jsonlint.com to check your JSON before pasting it as a secret.`
    );
  }

  if (typeof config !== "object" || Array.isArray(config)) {
    throw new Error("ACCOUNTS_JSON must be a JSON object with 'cloudflare' and/or 'github' arrays.");
  }

  const errors = [];

  if (config.cloudflare !== undefined) {
    if (!Array.isArray(config.cloudflare)) {
      errors.push("'cloudflare' must be an array of account objects.");
    } else {
      config.cloudflare.forEach((acc, i) => {
        if (!acc.token)      {errors.push(`cloudflare[${i}]: missing required field 'token'`);}
        if (!acc.account_id) {errors.push(`cloudflare[${i}]: missing required field 'account_id'`);}
        if (!acc.label)      {errors.push(`cloudflare[${i}]: missing 'label' (used in logs and summary)`);}
        // HK-17: type-check numeric fields so silent NaN comparisons can't bypass gates
        if (acc.keep_count !== undefined && typeof acc.keep_count !== "number") {
          errors.push(`cloudflare[${i}]: 'keep_count' must be a number, got ${typeof acc.keep_count}`);
        }
        if (acc.min_age_days !== undefined && (typeof acc.min_age_days !== "number" || isNaN(acc.min_age_days))) {
          errors.push(`cloudflare[${i}]: 'min_age_days' must be a number, got ${typeof acc.min_age_days}`);
        }
      });
    }
  }

  if (config.github !== undefined) {
    if (!Array.isArray(config.github)) {
      errors.push("'github' must be an array of account objects.");
    } else {
      config.github.forEach((acc, i) => {
        if (!acc.token) {errors.push(`github[${i}]: missing required field 'token'`);}
        if (!acc.label) {errors.push(`github[${i}]: missing 'label' (used in logs and summary)`);}
        if (acc.keep_count !== undefined && typeof acc.keep_count !== "number") {
          errors.push(`github[${i}]: 'keep_count' must be a number, got ${typeof acc.keep_count}`);
        }
        if (acc.min_age_days !== undefined && (typeof acc.min_age_days !== "number" || isNaN(acc.min_age_days))) {
          errors.push(`github[${i}]: 'min_age_days' must be a number, got ${typeof acc.min_age_days}`);
        }
        if (!acc.users?.length && !acc.orgs?.length) {
          errors.push(`github[${i}]: must specify at least one 'users' or 'orgs' entry`);
        }
        if (acc.clean_git_history) {
          // HK-29: git_history_repos is optional — omit to auto-discover from users/orgs
          if (acc.git_history_repos !== undefined) {
            const validEntries = Array.isArray(acc.git_history_repos) && acc.git_history_repos.every((r) => {
              if (typeof r !== "string") {return false;}
              const idx = r.indexOf("/");
              return idx > 0 && idx < r.length - 1;
            });
            if (!validEntries) {
              errors.push(`github[${i}]: each 'git_history_repos' entry must be a string in "owner/repo" format (non-empty owner and repo)`);
            }
          }
          const khc = acc.keep_history_count;
          if (khc !== undefined && (typeof khc !== "number" || !Number.isInteger(khc) || khc < 0)) {
            errors.push(`github[${i}]: 'keep_history_count' must be a non-negative integer (0 = full sweep)`);
          }
        }
      });
    }
  }

  if (!config.cloudflare && !config.github) {
    errors.push("ACCOUNTS_JSON must contain at least one 'cloudflare' or 'github' array.");
  }

  if (errors.length) {
    throw new Error(
      `ACCOUNTS_JSON validation failed with ${errors.length} error(s):\n` +
      errors.map((e, i) => `  ${i + 1}. ${e}`).join("\n")
    );
  }

  return config;
}

// ── Summary Builder ───────────────────────────────────────────────────────────

class SummaryReport {
  constructor() {
    this.rows = [];
    this.errors = [];
  }

  add(account, platform, type, deleted, skipped) {
    this.rows.push({ account, platform, type, deleted, skipped });
  }

  addError(account, platform, message) {
    this.errors.push({ account, platform, message });
  }

  async write() {
    if (!SUMMARY_FILE) {return;}
    const mode = DRY_RUN ? " *(Dry Run)*" : "";
    const lines = [
      `## 🧹 TWDxHouseKeeping Report${mode}`,
      ``,
      `**Run:** ${new Date().toUTCString()}`,
      ``,
      `### Cleanup Summary`,
      ``,
      `| Account | Platform | Type | Deleted | Skipped |`,
      `| --- | --- | --- | --- | --- |`,
    ];

    for (const r of this.rows) {
      const del = DRY_RUN ? `~~${r.deleted}~~ *(dry run)*` : String(r.deleted);
      lines.push(`| ${r.account} | ${r.platform} | ${r.type} | ${del} | ${r.skipped} |`);
    }

    if (!this.rows.length) {
      lines.push(`| — | — | — | Nothing to clean | — |`);
    }

    if (this.errors.length) {
      lines.push(``, `### ⚠️ Errors`, ``);
      for (const e of this.errors) {
        lines.push(`- **${e.account}** (${e.platform}): ${e.message}`);
      }
    }

    lines.push(
      ``,
      `---`,
      `💛 TWDxHouseKeeping is open source — consider sponsoring → https://github.com/sponsors/thewebdexter`
    );

    // HK-20: Never let summary write failure crash the run before Discord fires
    try {
      fs.appendFileSync(SUMMARY_FILE, lines.join("\n") + "\n");
    } catch (err) {
      console.warn(`⚠️  Failed to write step summary: ${sanitizeError(err)}`);
    }
  }
}

// ── Discord Notifier ──────────────────────────────────────────────────────────

async function sendDiscordNotification(report, hasErrors, runUrl) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {return;} // silently skip — secret not configured

  const totalDeleted = report.rows.reduce((s, r) => s + r.deleted, 0);
  const totalSkipped = report.rows.reduce((s, r) => s + r.skipped, 0);
  const timestamp    = new Date().toISOString();

  let color;
  if (DRY_RUN)        {color = 0x5865F2;} // Discord blurple — dry run
  else if (hasErrors) {color = 0xED4245;} // red — errors
  else if (totalDeleted > 0) {color = 0x57F287;} // green — cleaned something
  else                {color = 0xFEE75C;} // yellow — nothing to clean

  const modeBadge = DRY_RUN ? "🔍 Dry Run" : "🗑️ Live Run";
  const statusLine = hasErrors
    ? "⚠️ Completed with errors"
    : totalDeleted > 0
    ? "✅ Completed successfully"
    : "✅ Completed — nothing to clean";

  const tableLines = [];
  if (report.rows.length === 0) {
    tableLines.push("No cleanable items found across all accounts.");
  } else {
    // Group by account for compact display
    const byAccount = {};
    for (const r of report.rows) {
      if (!byAccount[r.account]) {byAccount[r.account] = [];}
      byAccount[r.account].push(r);
    }
    for (const [acct, rows] of Object.entries(byAccount)) {
      tableLines.push(`**${acct}**`);
      for (const r of rows) {
        const delText = DRY_RUN ? `~~${r.deleted}~~ (dry)` : String(r.deleted);
        tableLines.push(`  ${r.platform} ${r.type}: ${delText} deleted · ${r.skipped} kept`);
      }
    }
  }

  // Discord field values are capped at 1024 chars — truncate gracefully
  const tableValue = tableLines.join("\n").slice(0, 1020) || "—";

  const errorLines = report.errors.map(
    (e) => `• **${e.account}** (${e.platform}): ${e.message}`
  );
  const errorValue = errorLines.join("\n").slice(0, 1020) || null;

  const fields = [
    {
      name: "📊 Summary",
      value: tableValue,
      inline: false,
    },
    {
      name: "🔢 Totals",
      value: `**Deleted:** ${DRY_RUN ? `~~${totalDeleted}~~ (dry run)` : totalDeleted}\n**Kept/Skipped:** ${totalSkipped}`,
      inline: true,
    },
    {
      name: "⚙️ Mode",
      value: modeBadge,
      inline: true,
    },
  ];

  if (errorValue) {
    fields.push({
      name: "❌ Errors",
      value: errorValue,
      inline: false,
    });
  }

  if (runUrl) {
    fields.push({
      name: "🔗 Actions Run",
      value: `[View full log](${runUrl})`,
      inline: false,
    });
  }

  const payload = {
    username: "TWDxHouseKeeping",
    avatar_url: "https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png",
    embeds: [
      {
        title: "🧹 TWDxHouseKeeping Report",
        description: statusLine,
        color,
        fields,
        footer: {
          text: "TheWebDexter.com · TWDxHouseKeeping",
        },
        timestamp,
      },
    ],
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`⚠️  Discord notification failed: HTTP ${res.status} — ${body}`);
    } else {
      console.log("📣  Discord notification sent.");
    }
  } catch (err) {
    // Never let a notification failure crash the script
    console.warn(`⚠️  Discord notification error: ${sanitizeError(err)}`);
  }
}

// ── Cloudflare Cleanup ────────────────────────────────────────────────────────

async function cleanCloudflare(acc, report) {
  const label    = acc.label;
  const token    = acc.token;
  const accountId = acc.account_id;
  const keepCount = keepCountFloor(acc.keep_count, label);
  const minAge    = acc.min_age_days ?? 0;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  console.log(`\n☁️  Cloudflare — [account]`);
  console.log(`   keep_count=${keepCount}  min_age_days=${minAge}  dry_run=${DRY_RUN}`);

  // ── Pages ──────────────────────────────────────────────────────────────────
  if (acc.clean_pages) {
    try {
      let deleted = 0, skipped = 0;
      const allProjects = [];
      {
        // HK-21: Pages projects endpoint does not accept page/per_page — returns all projects in one response.
        const res = await apiFetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
          { headers }
        );
        allProjects.push(...(res?.result ?? []));
      }

      for (const project of allProjects) {
        await sleep(300);
        const all = [];
        {
          let page = 1;
          while (true) {
            const res = await apiFetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}/deployments?per_page=25&page=${page}`,
              { headers }
            );
            const batch = res?.result ?? [];
            all.push(...batch);
            const info = res?.result_info;
            if (!batch.length || (info && page * info.per_page >= info.total_count)) {break;}
            page++;
            await sleep(300);
          }
        }

        // HK-13: find the active deployment ID
        const activeId = project.latest_deployment?.id ?? null;

        const eligible = all
          .filter((d) => d.id !== activeId)                          // HK-13: never delete active
          .filter((d) => !d.aliases?.length)                         // HK-24: never delete aliased deployments (CF 8000035)
          .filter((d) => ageInDays(d.created_on) >= minAge)          // HK-12: age gate
          .sort((a, b) => new Date(b.created_on) - new Date(a.created_on))
          .slice(keepCount);                                          // HK-04: keep N most recent

        for (const dep of eligible) {
          console.log(`   ${DRY_RUN ? "[DRY]" : "DEL"} Pages deployment ${dep.id} (${project.name})`);
          // HK-26: per-deployment isolation — aliased deployments where aliases was null/missing in
          // the list response (not caught by HK-24) return 8000035; any other 4xx is also handled.
          let deleteOk = true;
          if (!DRY_RUN) {
            try {
              await apiFetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}/deployments/${dep.id}`,
                { method: "DELETE", headers }
              );
              await sleep(500);
            } catch (depErr) {
              console.warn(`   ⚠️  Pages deployment ${dep.id} could not be deleted — ${sanitizeError(depErr)}`);
              deleteOk = false;
              skipped++;
            }
          }
          if (deleteOk) { deleted++; }
        }
        skipped += all.length - eligible.length;
      }

      console.log(`   Pages: ${deleted} deleted, ${skipped} kept/skipped`);
      report.add(label, "Cloudflare", "Pages", deleted, skipped);
    } catch (err) {
      const safe = sanitizeError(err);
      console.error(`   ❌ Pages cleanup failed: ${safe}`);
      report.addError(label, "Cloudflare Pages", safe);
    }
  }

  // ── Workers ────────────────────────────────────────────────────────────────
  if (acc.clean_workers) {
    try {
      let deleted = 0, skipped = 0;
      const workers = await apiFetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
        { headers }
      );

      // HK-22: Cloudflare's API does not support DELETE on individual script versions.
      // Cleanup operates at the script level — sort by modified_on, apply age gate and keep_count,
      // then delete entire scripts via DELETE /workers/scripts/{id}.
      const all = (workers?.result ?? [])
        .sort((a, b) => new Date(b.modified_on) - new Date(a.modified_on));

      const eligible = all
        .filter((w) => ageInDays(w.modified_on) >= minAge)  // HK-12: age gate
        .slice(keepCount);                                    // HK-04: keep N most recently modified

      for (const worker of eligible) {
        await sleep(300);
        // HK-23: fetch current deployment before deleting. Skip any script with a version
        // receiving >0% traffic. Defaults to "active" (skip) if the check itself fails.
        let isActive = true;
        try {
          const dep = await apiFetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.id}/deployments`,
            { headers }
          );
          const versions = dep?.result?.versions ?? [];
          // HK-27: no version data (old Upload-API workers) → default to active so they are never deleted.
          isActive = !versions.length || versions.some((v) => (v.percentage ?? 0) > 0);
        } catch {
          // deployment fetch failed — treat as active to avoid accidental delete
        }

        if (isActive) {
          console.log(`   ⏭️  Worker script ${worker.id} skipped — active deployment`);
          skipped++;
          continue;
        }

        console.log(`   ${DRY_RUN ? "[DRY]" : "DEL"} Worker script ${worker.id}`);
        // HK-25: per-worker isolation — a binding restriction (e.g. Queue consumer, CF 10064) or
        // any other 4xx on DELETE skips this script and continues rather than aborting the block.
        let deleteOk = true;
        if (!DRY_RUN) {
          try {
            await apiFetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.id}`,
              { method: "DELETE", headers }
            );
            await sleep(500);
          } catch (workerErr) {
            console.warn(`   ⚠️  Worker script ${worker.id} could not be deleted — ${sanitizeError(workerErr)}`);
            deleteOk = false;
            skipped++;
          }
        }
        if (deleteOk) { deleted++; }
      }
      skipped += all.length - eligible.length;

      console.log(`   Workers: ${deleted} deleted, ${skipped} kept/skipped`);
      report.add(label, "Cloudflare", "Workers", deleted, skipped);
    } catch (err) {
      const safe = sanitizeError(err);
      console.error(`   ❌ Workers cleanup failed: ${safe}`);
      report.addError(label, "Cloudflare Workers", safe);
    }
  }
}

// ── GitHub Cleanup ────────────────────────────────────────────────────────────

async function cleanGitHub(acc, report) {
  const label     = acc.label;
  const token     = acc.token;
  const keepCount = keepCountFloor(acc.keep_count, label);
  const minAge    = acc.min_age_days ?? 0;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };

  console.log(`\n🐙  GitHub — [account]`);
  console.log(`   keep_count=${keepCount}  min_age_days=${minAge}  dry_run=${DRY_RUN}`);

  // Collect all repos from users + orgs
  const repos = [];
  for (const user of acc.users ?? []) {
    try {
      let page = 1;
      while (true) {
        // HK-28: /user/repos (authenticated) returns private repos; /users/{u}/repos is public-only
        const batch = await apiFetch(
          `https://api.github.com/user/repos?visibility=all&affiliation=owner&per_page=100&page=${page}`,
          { headers }
        );
        if (!batch?.length) {break;}
        repos.push(...batch.map((r) => ({ owner: r.owner.login, repo: r.name })));
        page++;
        await sleep(200);
      }
    } catch (err) {
      const safe = sanitizeError(err);
      console.error(`   ❌ Could not list repos for user ${user}: ${safe}`);
      report.addError(label, "GitHub", `List repos for ${user}: ${safe}`);
    }
  }
  for (const org of acc.orgs ?? []) {
    try {
      let page = 1;
      while (true) {
        const batch = await apiFetch(
          `https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}`,
          { headers }
        );
        if (!batch?.length) {break;}
        repos.push(...batch.map((r) => ({ owner: r.owner.login, repo: r.name })));
        page++;
        await sleep(200);
      }
    } catch (err) {
      const safe = sanitizeError(err);
      console.error(`   ❌ Could not list repos for org ${org}: ${safe}`);
      report.addError(label, "GitHub", `List repos for ${org}: ${safe}`);
    }
  }

  // ── Deployments ────────────────────────────────────────────────────────────
  if (acc.clean_deployments) {
    let totalDeleted = 0, totalSkipped = 0;
    for (const { owner, repo } of repos) {
      try {
        await sleep(200);
        const all = [];
        {
          let page = 1;
          while (true) {
            const batch = await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100&page=${page}`,
              { headers }
            );
            if (!batch?.length) {break;}
            all.push(...batch);
            page++;
            await sleep(200);
          }
        }
        if (!all.length) {continue;}

        // HK-13: find active deployments (status = active)
        const activeIds = new Set();
        for (const dep of all) {
          const statuses = await apiFetch(
            `https://api.github.com/repos/${owner}/${repo}/deployments/${dep.id}/statuses?per_page=1`,
            { headers }
          );
          if (statuses?.[0]?.state === "active") {activeIds.add(dep.id);}
          await sleep(100);
        }

        // HK-31: group by environment so keep_count is applied per environment, not per repo
        const byEnv = new Map();
        for (const dep of all) {
          const env = dep.environment ?? "";
          if (!byEnv.has(env)) { byEnv.set(env, []); }
          byEnv.get(env).push(dep);
        }
        const eligible = [];
        for (const envDeps of byEnv.values()) {
          const toDelete = envDeps
            .filter((d) => !activeIds.has(d.id))                     // HK-13: skip active
            .filter((d) => ageInDays(d.created_at) >= minAge)        // HK-12: age gate
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(keepCount);                                        // HK-04: keep N per env
          eligible.push(...toDelete);
        }

        for (const dep of eligible) {
          console.log(`   ${DRY_RUN ? "[DRY]" : "DEL"} Deployment ${dep.id} (${owner}/${repo})`);
          if (!DRY_RUN) {
            // Must set inactive first before deletion
            await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/deployments/${dep.id}/statuses`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({ state: "inactive" }),
              }
            );
            await sleep(300);
            await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/deployments/${dep.id}`,
              { method: "DELETE", headers }
            );
            await sleep(500);
          }
          totalDeleted++;
        }
        totalSkipped += all.length - eligible.length;
      } catch (err) {
        const safe = sanitizeError(err);
        console.error(`   ❌ Deployments failed for ${owner}/${repo}: ${safe}`);
        report.addError(label, "GitHub Deployments", `${owner}/${repo}: ${safe}`);
      }
    }
    console.log(`   Deployments: ${totalDeleted} deleted, ${totalSkipped} kept/skipped`);
    report.add(label, "GitHub", "Deployments", totalDeleted, totalSkipped);
  }

  // ── Actions / Workflow Runs ────────────────────────────────────────────────
  if (acc.clean_actions) {
    let totalDeleted = 0, totalSkipped = 0;
    for (const { owner, repo } of repos) {
      try {
        await sleep(200);
        let page = 1;
        const allRuns = [];
        while (true) {
          const batch = await apiFetch(
            `https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=100&page=${page}`,
            { headers }
          );
          if (!batch?.workflow_runs?.length) {break;}
          allRuns.push(...batch.workflow_runs);
          page++;
          await sleep(200);
        }

        // HK-30: group by workflow_id so keep_count is applied per workflow, not per repo
        const byWorkflow = new Map();
        for (const run of allRuns) {
          const wfId = run.workflow_id;
          if (!byWorkflow.has(wfId)) { byWorkflow.set(wfId, []); }
          byWorkflow.get(wfId).push(run);
        }
        const eligible = [];
        for (const wfRuns of byWorkflow.values()) {
          const toDelete = wfRuns
            .filter((r) => r.status === "completed")                 // never delete in-progress
            .filter((r) => ageInDays(r.created_at) >= minAge)        // HK-12: age gate
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(keepCount);                                        // HK-04: keep N per workflow
          eligible.push(...toDelete);
        }

        for (const run of eligible) {
          console.log(`   ${DRY_RUN ? "[DRY]" : "DEL"} Workflow run ${run.id} (${owner}/${repo})`);
          if (!DRY_RUN) {
            await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/actions/runs/${run.id}`,
              { method: "DELETE", headers }
            );
            await sleep(500);
          }
          totalDeleted++;
        }
        totalSkipped += allRuns.length - eligible.length;
      } catch (err) {
        const safe = sanitizeError(err);
        console.error(`   ❌ Actions cleanup failed for ${owner}/${repo}: ${safe}`);
        report.addError(label, "GitHub Actions", `${owner}/${repo}: ${safe}`);
      }
    }
    console.log(`   Actions: ${totalDeleted} deleted, ${totalSkipped} kept/skipped`);
    report.add(label, "GitHub", "Actions", totalDeleted, totalSkipped);
  }

  // ── Git History ────────────────────────────────────────────────────────────
  if (acc.clean_git_history) {
    // HK-29: fall back to auto-discovered repos when git_history_repos is not explicitly set
    const historyRepos = acc.git_history_repos?.length
      ? acc.git_history_repos
      : repos.map(({ owner, repo }) => `${owner}/${repo}`);
    const keepHistoryCount = Math.max(0, parseInt(acc.keep_history_count ?? 0, 10) || 0);
    const SWEEP_MSG       = "Swept clean by the TWDxHouseKeeping";
    let totalRewritten = 0, totalSkipped = 0;

    console.log(`\n   📜  Git History: keep_history_count=${keepHistoryCount}`);

    for (const fullRepo of historyRepos) {
      try {
        const slashIdx = fullRepo.indexOf("/");
        // HK-18: validateConfig checks for "/" but passes "owner/" and "/repo" — guard here too
        if (slashIdx <= 0 || slashIdx === fullRepo.length - 1) {
          console.error(`   ❌ Invalid git_history_repos entry: "${fullRepo}" — must be "owner/repo"`);
          report.addError(label, "GitHub Git History", `Invalid repo format: ${fullRepo}`);
          continue;
        }
        const owner = fullRepo.slice(0, slashIdx);
        const repo  = fullRepo.slice(slashIdx + 1);

        // Resolve default branch
        const repoInfo = await apiFetch(
          `https://api.github.com/repos/${owner}/${repo}`,
          { headers }
        );
        const branch = repoInfo.default_branch;
        await sleep(200);

        // Get HEAD SHA for the branch
        const refData = await apiFetch(
          `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
          { headers }
        );
        const headSha = refData.object.sha;
        await sleep(200);

        if (keepHistoryCount === 0) {
          // Full sweep — single orphan commit carrying the current tree
          const headCommit = await apiFetch(
            `https://api.github.com/repos/${owner}/${repo}/git/commits/${headSha}`,
            { headers }
          );
          const treeSha = headCommit.tree.sha;
          await sleep(200);

          console.log(`   ${DRY_RUN ? "[DRY]" : "SWEEP"} ${owner}/${repo}@${branch} — full history wipe`);

          if (!DRY_RUN) {
            // No "parents" field → orphan commit
            const newCommit = await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/git/commits`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({ message: SWEEP_MSG, tree: treeSha }),
              }
            );
            await sleep(300);

            await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
              {
                method: "PATCH",
                headers,
                body: JSON.stringify({ sha: newCommit.sha, force: true }),
              }
            );
            await sleep(500);
          }
          totalRewritten++;

        } else {
          // Trim history — squash commits older than the Nth, replay the N newest
          const commits = await apiFetch(
            `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${keepHistoryCount + 1}&sha=${branch}`,
            { headers }
          );
          await sleep(200);

          if (commits.length <= keepHistoryCount) {
            // Already at or under the keep limit — nothing to squash
            console.log(`   SKIP ${owner}/${repo}@${branch} — ${commits.length} commit(s) ≤ keep_history_count=${keepHistoryCount}`);
            totalSkipped++;
            continue;
          }

          // commits[0]=HEAD (newest) … commits[keepHistoryCount]=boundary
          // HK-19: bounds-check before accessing — API may return fewer items than expected
          const boundaryCommit = commits[keepHistoryCount];
          if (!boundaryCommit?.commit?.tree?.sha) {
            console.warn(`   ⚠️  Boundary commit missing for ${owner}/${repo} — skipping`);
            totalSkipped++;
            continue;
          }
          const boundaryTreeSha = boundaryCommit.commit.tree.sha;
          const toReplay        = commits.slice(0, keepHistoryCount).reverse(); // oldest → newest

          console.log(`   ${DRY_RUN ? "[DRY]" : "TRIM"} ${owner}/${repo}@${branch} — squashing history, keeping ${keepHistoryCount} commit(s)`);

          if (!DRY_RUN) {
            // Orphan root carries the boundary tree
            const rootCommit = await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/git/commits`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({ message: SWEEP_MSG, tree: boundaryTreeSha }),
              }
            );
            let parentSha = rootCommit.sha;
            await sleep(300);

            for (const c of toReplay) {
              const newC = await apiFetch(
                `https://api.github.com/repos/${owner}/${repo}/git/commits`,
                {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    message: c.commit.message,
                    tree:    c.commit.tree.sha,
                    parents: [parentSha],
                  }),
                }
              );
              parentSha = newC.sha;
              await sleep(300);
            }

            await apiFetch(
              `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
              {
                method: "PATCH",
                headers,
                body: JSON.stringify({ sha: parentSha, force: true }),
              }
            );
            await sleep(500);
          }
          totalRewritten++;
        }
      } catch (err) {
        const safe = sanitizeError(err);
        console.error(`   ❌ Git history cleanup failed for ${fullRepo}: ${safe}`);
        report.addError(label, "GitHub Git History", `${fullRepo}: ${safe}`);
      }
    }

    console.log(`   Git History: ${totalRewritten} rewritten, ${totalSkipped} skipped`);
    report.add(label, "GitHub", "Git History", totalRewritten, totalSkipped);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const raw = process.env.ACCOUNTS_JSON;
  if (!raw) {
    console.error("❌  ACCOUNTS_JSON environment variable is not set.");
    console.error("    Add it as a Repository Secret and reference it in your workflow.");
    process.exit(1);
  }

  let config;
  try {
    config = validateConfig(raw);
  } catch (err) {
    console.error(`❌  Config Error:\n${err.message}`);
    process.exit(1);
  }

  const report = new SummaryReport();
  let hasErrors = false;

  // HK-11: Per-account isolation — one failure never stops the others
  for (const acc of config.cloudflare ?? []) {
    try {
      await cleanCloudflare(acc, report);
    } catch (err) {
      hasErrors = true;
      const safe = sanitizeError(err);
      console.error(`\n❌  Unhandled error for Cloudflare account: ${safe}`);
      report.addError(acc.label ?? "unknown", "Cloudflare", safe);
    }
  }

  for (const acc of config.github ?? []) {
    try {
      await cleanGitHub(acc, report);
    } catch (err) {
      hasErrors = true;
      const safe = sanitizeError(err);
      console.error(`\n❌  Unhandled error for GitHub account: ${safe}`);
      report.addError(acc.label ?? "unknown", "GitHub", safe);
    }
  }

  await report.write();

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  await sendDiscordNotification(report, hasErrors, runUrl);

  console.log(`\n✅  Housekeeping complete${DRY_RUN ? " (dry run — nothing was deleted)" : ""}`);

  if (hasErrors) {
    console.error("⚠️  Some accounts encountered errors. Check the log above.");
    process.exit(1);
  }
}

if (process.env.NODE_ENV === "test") {
  // Allow unit tests to import pure functions without triggering main()
  module.exports = { validateConfig, sanitizeError, keepCountFloor, ageInDays };
} else {
  main().catch((err) => {
    console.error("💥  Fatal:", sanitizeError(err));
    process.exit(1);
  });
}
