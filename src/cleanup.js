/**
 * TWDxHouseKeeping Tools — src/cleanup.js
 * Developer: https://www.TheWebDexter.com
 * Features: GitHub (Deployments + Actions), Cloudflare (Workers, Pages + Versions)
 */

const GH_API = "https://api.github.com";
const CF_API = "https://api.cloudflare.com/client/v4";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCleanup() {
  console.log("🧹 TWDxHouseKeeping Tools INITIALIZED...");
  console.log("🌐 Developer: https://www.TheWebDexter.com\n");
  
  const accountsStr = process.env.ACCOUNTS_JSON;
  if (!accountsStr) {
    console.error("❌ ERROR: ACCOUNTS_JSON secret is missing!");
    process.exit(1);
  }

  const accounts = JSON.parse(accountsStr);

  // 1. Process Cloudflare
  for (const cf of accounts.cloudflare || []) {
    console.log(`\n☁️ Processing Cloudflare Account: ${cf.label}`);
    const h = { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" };
    const count = cf.keep_count ?? 1;

    // Clean Workers & Versions
    if (cf.clean_workers || cf.clean_versions) {
      const wRes = await fetch(`${CF_API}/accounts/${cf.account_id}/workers/scripts`, { headers: h });
      if (wRes.ok) {
        const scripts = (await wRes.json())?.result || [];
        for (const s of scripts) await cleanupWorkerDeep(cf.account_id, s.id, h, count, cf);
      }
    }

    // Clean Pages
    if (cf.clean_pages) {
      const pRes = await fetch(`${CF_API}/accounts/${cf.account_id}/pages/projects`, { headers: h });
      if (pRes.ok) {
        const projects = (await pRes.json())?.result || [];
        for (const project of projects) await cleanupPagesDeployments(cf.account_id, project.name, h, count);
      }
    }
  }

  // 2. Process GitHub
  for (const gh of accounts.github || []) {
    console.log(`\n🐙 Processing GitHub Account: ${gh.label}`);
    const h = { 
      Authorization: `Bearer ${gh.token}`, 
      Accept: "application/vnd.github+json", 
      "X-GitHub-Api-Version": "2022-11-28", 
      "User-Agent": "TWDxHouseKeeping-Tools/1.0" 
    };
    const repos = await fetchAllRepos(gh, h);
    const count = gh.keep_count ?? 1;
    
    for (const repo of repos) {
      console.log(`  📦 Repo [${repo.full_name}]`);
      if (gh.clean_deployments) await pruneGHDeployments(repo.full_name, h, count);
      if (gh.clean_actions) await cleanupGitHubActions(repo.full_name, h, count);
      await delay(100);
    }
  }

  console.log("\n✅ TWDxHouseKeeping COMPLETE.");
}

// ── CLOUDFLARE HELPERS ────────────────────────────────────────────────
async function cleanupWorkerDeep(accountId, workerId, headers, count, flags) {
  // A. Clean Deployments (Traffic routing history)
  if (flags.clean_workers) {
    const dRes = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerId}/deployments`, { headers });
    if (dRes.ok) {
      const deps = (await dRes.json())?.result?.items || [];
      if (deps.length > count) {
        console.log(`      ⚡ Worker [${workerId}]: Found ${deps.length} deployments. Cleaning...`);
        for (let i = count; i < deps.length; i++) {
          await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerId}/deployments/${deps[i].id}`, { method: "DELETE", headers });
          await delay(50);
        }
      }
    }
  }

  // B. Clean Versions (Code history - Beta API)
  if (flags.clean_versions) {
    const vRes = await fetch(`${CF_API}/accounts/${accountId}/workers/workers/${workerId}/versions`, { headers });
    if (vRes.ok) {
      const versions = (await vRes.json())?.result || [];
      
      // SAFE SORT: Handles cases where metadata.timestamp might be missing
      versions.sort((a, b) => {
        const timeA = a.metadata?.timestamp ? new Date(a.metadata.timestamp).getTime() : 0;
        const timeB = b.metadata?.timestamp ? new Date(b.metadata.timestamp).getTime() : 0;
        return timeB - timeA;
      });

      if (versions.length > count) {
        console.log(`      ⚡ Versions [${workerId}]: Found ${versions.length}. Purging history...`);
        for (let i = count; i < versions.length; i++) {
          const r = await fetch(`${CF_API}/accounts/${accountId}/workers/workers/${workerId}/versions/${versions[i].id}`, { method: "DELETE", headers });
          if (r.ok) console.log(`          🗑️ Purged Code: ${versions[i].id.slice(0,8)}`);
          else if (r.status === 409) console.log(`          ⏭️ Skipped: Version ${versions[i].id.slice(0,8)} is currently active.`);
          await delay(100);
        }
      }
    }
  }
}

async function cleanupPagesDeployments(accountId, projectName, headers, count) {
  let allDeps = [];
  let page = 1;
  while (true) {
    const r = await fetch(`${CF_API}/accounts/${accountId}/pages/projects/${projectName}/deployments?per_page=25&page=${page}`, { headers });
    if (!r.ok) break;
    const items = (await r.json())?.result || [];
    if (!items.length) break;
    allDeps = allDeps.concat(items);
    if (items.length < 25) break;
    page++;
  }
  allDeps.sort((a, b) => new Date(b.created_on) - new Date(a.created_on));
  if (allDeps.length > count) {
    console.log(`      📄 Pages [${projectName}]: Found ${allDeps.length}. Deleting...`);
    for (let i = count; i < allDeps.length; i++) {
      await fetch(`${CF_API}/accounts/${accountId}/pages/projects/${projectName}/deployments/${allDeps[i].id}?force=true`, { method: "DELETE", headers });
      await delay(50);
    }
  }
}

// ── GITHUB HELPERS ────────────────────────────────────────────────────
async function fetchAllRepos(gh, headers) {
  let repos = [];
  for (const org of gh.orgs || []) repos = repos.concat(await ghPaginate(`${GH_API}/orgs/${org}/repos?per_page=100&type=all`, headers));
  for (const user of gh.users || []) repos = repos.concat(await ghPaginate(`${GH_API}/users/${user}/repos?per_page=100&type=all`, headers));
  const seen = new Set();
  return repos.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

async function pruneGHDeployments(repo, headers, count) {
  const envRes = await fetch(`${GH_API}/repos/${repo}/environments`, { headers }).then(r => r.ok ? r.json() : null);
  const targets = (envRes?.environments || []).length > 0 ? envRes.environments.map(e => e.name) : [null];
  for (const envName of targets) {
    const qs = envName ? `?environment=${encodeURIComponent(envName)}&per_page=100` : "?per_page=100";
    const deps = await ghPaginate(`${GH_API}/repos/${repo}/deployments${qs}`, headers);
    if (deps.length > count) {
      console.log(`      ⚡ Found ${deps.length} deployments in ${envName || 'default env'}. Cleaning...`);
      for (let i = count; i < deps.length; i++) {
        await fetch(`${GH_API}/repos/${repo}/deployments/${deps[i].id}/statuses`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ state: "inactive" }),
        }).catch(() => {});
        await fetch(`${GH_API}/repos/${repo}/deployments/${deps[i].id}`, { method: "DELETE", headers });
        await delay(50);
      }
    }
  }
}

async function cleanupGitHubActions(repo, headers, count) {
  const runsRes = await fetch(`${GH_API}/repos/${repo}/actions/runs?per_page=100`, { headers }).then(r => r.ok ? r.json() : null);
  const runs = (runsRes?.workflow_runs || [])
                 .filter(r => r.id.toString() !== process.env.GITHUB_RUN_ID)
                 .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (runs.length <= count) return;
  const toDelete = runs.slice(count);
  console.log(`      🎬 Actions: Found ${runs.length}. Purging oldest ${toDelete.length}...`);
  for (const run of toDelete) {
    await fetch(`${GH_API}/repos/${repo}/actions/runs/${run.id}`, { method: "DELETE", headers });
    await delay(50);
  }
}

async function ghPaginate(url, headers) {
  let results = [], nextUrl = url;
  while (nextUrl) {
    const r = await fetch(nextUrl, { headers });
    if (!r.ok) break;
    const data = await r.json();
    if (Array.isArray(data)) results = results.concat(data);
    else if (Array.isArray(data?.items)) results = results.concat(data.items);
    else return data;
    const m = (r.headers.get("Link") || "").match(/<([^>]+)>;\s*rel="next"/);
    nextUrl = m ? m[1] : null;
    await delay(50);
  }
  return results;
}

runCleanup();
