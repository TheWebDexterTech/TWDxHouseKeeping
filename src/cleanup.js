/**
 * TWDxHouseKeeping — cleanup.js
 * Developed by TheWebDexter.com
 *
 * Fixes applied:
 *   HK-01 — Dry-run mode (DRY_RUN=true by default for safety)
 *   HK-03 — Full ACCOUNTS_JSON schema validation with clear errors
 *   HK-04 — keep_count hard floor of 1
 *   HK-10 — GitHub Actions Step Summary report
 *   HK-11 — Per-account error isolation (one failure doesn't stop others)
 *   HK-12 — min_age_days filter (skip items newer than N days)
 *   HK-13 — Live/active deployment safeguard (never delete the active one)
 */

"use strict";

// ── Config & Environment ──────────────────────────────────────────────────────

const DRY_RUN = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY ?? null;

if (DRY_RUN) {
  console.log("🔍  DRY-RUN MODE — no deletions will be made");
  console.log("    Set DRY_RUN=false in your workflow env to run for real.\n");
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  if (res.status === 204) return null;
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
  if (isNaN(n) || n < 1) {
    console.warn(`  ⚠️  keep_count "${val}" for "${label}" is invalid — defaulting to 1`);
    return 1;
  }
  return n;
}

// ── Schema Validation ─────────────────────────────────────────────────────────

function validateConfig(raw) {
  let config;
  try {
    config = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `ACCOUNTS_JSON is not valid JSON.\n` +
      `Parse error: ${e.message}\n` +
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
        if (!acc.token)      errors.push(`cloudflare[${i}]: missing required field 'token'`);
        if (!acc.account_id) errors.push(`cloudflare[${i}]: missing required field 'account_id'`);
        if (!acc.label)      errors.push(`cloudflare[${i}]: missing 'label' (used in logs and summary)`);
      });
    }
  }

  if (config.github !== undefined) {
    if (!Array.isArray(config.github)) {
      errors.push("'github' must be an array of account objects.");
    } else {
      config.github.forEach((acc, i) => {
        if (!acc.token) errors.push(`github[${i}]: missing required field 'token'`);
        if (!acc.label) errors.push(`github[${i}]: missing 'label' (used in logs and summary)`);
        if (!acc.users?.length && !acc.orgs?.length) {
          errors.push(`github[${i}]: must specify at least one 'users' or 'orgs' entry`);
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

  add(account, platform, type, deleted, skipped, dryRun) {
    this.rows.push({ account, platform, type, deleted, skipped, dryRun });
  }

  addError(account, platform, message) {
    this.errors.push({ account, platform, message });
  }

  async write() {
    if (!SUMMARY_FILE) return;
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

    const fs = await import("fs");
    fs.appendFileSync(SUMMARY_FILE, lines.join("\n") + "\n");
  }
}

// ── Discord Notifier ──────────────────────────────────────────────────────────

/**
 * Sends a rich embed to a Discord webhook after every run.
 *
 * Setup: Add DISCORD_WEBHOOK_URL as a Repository Secret.
 * If the secret is not set the notification step is silently skipped.
 *
 * Embed colours:
 *   Blue   (#5865F2) — dry run (nothing changed)
 *   Green  (#57F287) — success, at least one item deleted
 *   Yellow (#FEE75C) — success but nothing to clean
 *   Red    (#ED4245) — one or more accounts had errors
 */
async function sendDiscordNotification(report, hasErrors, runUrl) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return; // silently skip — secret not configured

  const totalDeleted = report.rows.reduce((s, r) => s + r.deleted, 0);
  const totalSkipped = report.rows.reduce((s, r) => s + r.skipped, 0);
  const timestamp    = new Date().toISOString();

  // ── Colour logic ────────────────────────────────────────────────────────────
  let color;
  if (DRY_RUN)        color = 0x5865F2; // Discord blurple — dry run
  else if (hasErrors) color = 0xED4245; // red — errors
  else if (totalDeleted > 0) color = 0x57F287; // green — cleaned something
  else                color = 0xFEE75C; // yellow — nothing to clean

  // ── Mode badge ──────────────────────────────────────────────────────────────
  const modeBadge = DRY_RUN ? "🔍 Dry Run" : "🗑️ Live Run";
  const statusLine = hasErrors
    ? "⚠️ Completed with errors"
    : totalDeleted > 0
    ? "✅ Completed successfully"
    : "✅ Completed — nothing to clean";

  // ── Per-account breakdown field ─────────────────────────────────────────────
  let tableLines = [];
  if (report.rows.length === 0) {
    tableLines.push("No cleanable items found across all accounts.");
  } else {
    // Group by account for compact display
    const byAccount = {};
    for (const r of report.rows) {
      if (!byAccount[r.account]) byAccount[r.account] = [];
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

  // ── Error field ─────────────────────────────────────────────────────────────
  const errorLines = report.errors.map(
    (e) => `• **${e.account}** (${e.platform}): ${e.message}`
  );
  const errorValue = errorLines.join("\n").slice(0, 1020) || null;

  // ── Build embed ─────────────────────────────────────────────────────────────
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
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`⚠️  Discord notification failed: HTTP ${res.status} — ${body}`);
    } else {
      console.log("📣  Discord notification sent.");
    }
  } catch (err) {
    // Never let a notification failure crash the script
    console.warn(`⚠️  Discord notification error: ${err.message}`);
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

  console.log(`\n☁️  Cloudflare — ${label}`);
  console.log(`   keep_count=${keepCount}  min_age_days=${minAge}  dry_run=${DRY_RUN}`);

  // ── Pages ──────────────────────────────────────────────────────────────────
  if (acc.clean_pages) {
    try {
      let deleted = 0, skipped = 0;
      const projects = await apiFetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
        { headers }
      );

      for (const project of projects?.result ?? []) {
        await sleep(300);
        const deps = await apiFetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}/deployments`,
          { headers }
        );
        const all = deps?.result ?? [];

        // HK-13: find the active deployment ID
        const activeId = project.latest_deployment?.id ?? null;

        const eligible = all
          .filter((d) => d.id !== activeId)                          // HK-13: never delete active
          .filter((d) => ageInDays(d.created_on) >= minAge)          // HK-12: age gate
          .sort((a, b) => new Date(b.created_on) - new Date(a.created_on))
          .slice(keepCount);                                          // HK-04: keep N most recent

        for (const dep of eligible) {
          console.log(`   ${DRY_RUN ? "[DRY]" : "DEL"} Pages deployment ${dep.id} (${project.name})`);
          if (!DRY_RUN) {
            await apiFetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}/deployments/${dep.id}`,
              { method: "DELETE", headers }
            );
            await sleep(500);
          }
          deleted++;
        }
        skipped += all.length - eligible.length;
      }

      console.log(`   Pages: ${deleted} deleted, ${skipped} kept/skipped`);
      report.add(label, "Cloudflare", "Pages", deleted, skipped);
    } catch (err) {
      console.error(`   ❌ Pages cleanup failed: ${err.message}`);
      report.addError(label, "Cloudflare Pages", err.message);
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

      for (const worker of workers?.result ?? []) {
        await sleep(300);
        const versions = await apiFetch(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.id}/versions`,
          { headers }
        );
        const all = versions?.result ?? [];

        // HK-13: keep the latest (index 0) as "live" — always skip it
        const eligible = all
          .slice(1)                                                   // HK-13: skip live version
          .filter((v) => ageInDays(v.metadata?.created_on ?? v.created_on) >= minAge)
          .slice(keepCount - 1);                                      // already kept [0], keep N-1 more

        for (const ver of eligible) {
          const vId = ver.id ?? ver.version_id;
          console.log(`   ${DRY_RUN ? "[DRY]" : "DEL"} Worker version ${vId} (${worker.id})`);
          if (!DRY_RUN) {
            await apiFetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${worker.id}/versions/${vId}`,
              { method: "DELETE", headers }
            );
            await sleep(500);
          }
          deleted++;
        }
        skipped += all.length - eligible.length;
      }

      console.log(`   Workers: ${deleted} deleted, ${skipped} kept/skipped`);
      report.add(label, "Cloudflare", "Workers", deleted, skipped);
    } catch (err) {
      console.error(`   ❌ Workers cleanup failed: ${err.message}`);
      report.addError(label, "Cloudflare Workers", err.message);
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
  };

  console.log(`\n🐙  GitHub — ${label}`);
  console.log(`   keep_count=${keepCount}  min_age_days=${minAge}  dry_run=${DRY_RUN}`);

  // Collect all repos from users + orgs
  const repos = [];
  for (const user of acc.users ?? []) {
    try {
      let page = 1;
      while (true) {
        const batch = await apiFetch(
          `https://api.github.com/users/${user}/repos?per_page=100&page=${page}`,
          { headers }
        );
        if (!batch?.length) break;
        repos.push(...batch.map((r) => ({ owner: r.owner.login, repo: r.name })));
        page++;
        await sleep(200);
      }
    } catch (err) {
      console.error(`   ❌ Could not list repos for user ${user}: ${err.message}`);
      report.addError(label, "GitHub", `List repos for ${user}: ${err.message}`);
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
        if (!batch?.length) break;
        repos.push(...batch.map((r) => ({ owner: r.owner.login, repo: r.name })));
        page++;
        await sleep(200);
      }
    } catch (err) {
      console.error(`   ❌ Could not list repos for org ${org}: ${err.message}`);
      report.addError(label, "GitHub", `List repos for ${org}: ${err.message}`);
    }
  }

  // ── Deployments ────────────────────────────────────────────────────────────
  if (acc.clean_deployments) {
    let totalDeleted = 0, totalSkipped = 0;
    for (const { owner, repo } of repos) {
      try {
        await sleep(200);
        const all = await apiFetch(
          `https://api.github.com/repos/${owner}/${repo}/deployments?per_page=100`,
          { headers }
        );
        if (!all?.length) continue;

        // HK-13: find active deployments (status = active)
        const activeIds = new Set();
        for (const dep of all) {
          const statuses = await apiFetch(
            `https://api.github.com/repos/${owner}/${repo}/deployments/${dep.id}/statuses?per_page=1`,
            { headers }
          );
          if (statuses?.[0]?.state === "active") activeIds.add(dep.id);
          await sleep(100);
        }

        const eligible = all
          .filter((d) => !activeIds.has(d.id))                       // HK-13: skip active
          .filter((d) => ageInDays(d.created_at) >= minAge)          // HK-12: age gate
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(keepCount);                                          // HK-04: keep N

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
        console.error(`   ❌ Deployments failed for ${owner}/${repo}: ${err.message}`);
        report.addError(label, "GitHub Deployments", `${owner}/${repo}: ${err.message}`);
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
          if (!batch?.workflow_runs?.length) break;
          allRuns.push(...batch.workflow_runs);
          page++;
          await sleep(200);
        }

        const eligible = allRuns
          .filter((r) => r.status === "completed")                   // never delete in-progress
          .filter((r) => ageInDays(r.created_at) >= minAge)          // HK-12: age gate
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
          .slice(keepCount);                                          // HK-04: keep N

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
        console.error(`   ❌ Actions cleanup failed for ${owner}/${repo}: ${err.message}`);
        report.addError(label, "GitHub Actions", `${owner}/${repo}: ${err.message}`);
      }
    }
    console.log(`   Actions: ${totalDeleted} deleted, ${totalSkipped} kept/skipped`);
    report.add(label, "GitHub", "Actions", totalDeleted, totalSkipped);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // HK-03: Validate config early, loud, and clear
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
      console.error(`\n❌  Unhandled error for Cloudflare account "${acc.label}": ${err.message}`);
      report.addError(acc.label ?? "unknown", "Cloudflare", err.message);
    }
  }

  for (const acc of config.github ?? []) {
    try {
      await cleanGitHub(acc, report);
    } catch (err) {
      hasErrors = true;
      console.error(`\n❌  Unhandled error for GitHub account "${acc.label}": ${err.message}`);
      report.addError(acc.label ?? "unknown", "GitHub", err.message);
    }
  }

  // HK-10: Write step summary
  await report.write();

  // Build the GitHub Actions run URL from env vars (available inside Actions)
  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  // Send Discord notification (no-op if DISCORD_WEBHOOK_URL secret is not set)
  await sendDiscordNotification(report, hasErrors, runUrl);

  console.log(`\n✅  Housekeeping complete${DRY_RUN ? " (dry run — nothing was deleted)" : ""}`);

  if (hasErrors) {
    console.error("⚠️  Some accounts encountered errors. Check the log above.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("💥  Fatal:", err.message);
  process.exit(1);
});
