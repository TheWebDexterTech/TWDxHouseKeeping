/**
 * TWDxHouseKeeping Tools — src/cleanup.js
 * Developer: https://www.TheWebDexter.com
 * Policy: Strict "No History" (Keeps exactly 1 live deployment/action run)
 */

const GH_API = "https://api.github.com";
const CF_API = "https://api.cloudflare.com/client/v4";
const KEEP_COUNT = 1; // Keeps ONLY the active deployment (index 0)

// Helper: Add a 100ms delay to avoid API rate limits
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runCleanup() {
  console.log("🧹 TWDxHouseKeeping Tools INITIALIZED...");
  console.log("🌐 Developer: https://www.TheWebDexter.com\n");
  
  const accountsStr = process.env.ACCOUNTS_JSON;
  
  if (!accountsStr) {
    console.error("❌ ERROR: ACCOUNTS_JSON secret is missing! Please configure your repository secrets.");
    process.exit(1);
  }

  let accounts = {};
  try {
    accounts = JSON.parse(accountsStr);
  } catch (e) {
    console.error("❌ ERROR: ACCOUNTS_JSON is not valid JSON!");
    process.exit(1);
  }

  // 1. Process Cloudflare
  for (const cf of accounts.cloudflare || []) {
    console.log(`\n☁️ Processing Cloudflare Account: ${cf.label}`);
    await cleanupCloudflareAccount(cf);
  }

  // 2. Process GitHub
  for (const gh of accounts.github || []) {
    console.log(`\n🐙 Processing GitHub Account: ${gh.label}`);
    await cleanupGitHubAccount(gh);
  }

  console.log("\n✅ TWDxHouseKeeping COMPLETE.");
}

// ── CLOUDFLARE LOGIC ──────────────────────────────────────────────────
async function cleanupCloudflareAccount(cf) {
  const h = { Authorization: `Bearer ${cf.token}`, "Content-Type": "application/json" };
  
  // Clean Workers
  const wRes = await fetch(`${CF_API}/accounts/${cf.account_id}/workers/scripts`, { headers: h });
  if (wRes.ok) {
    const scripts = (await wRes.json())?.result || [];
    for (const s of scripts) await cleanupWorkerDeployments(cf.account_id, s.id, h);
  } else {
    const errText = await wRes.text();
    console.error(`  ❌ Failed to fetch CF Workers: ${wRes.status} ${wRes.statusText} - ${errText}`);
  }

  // Clean Pages
  const pRes = await fetch(`${CF_API}/accounts/${cf.account_id}/pages/projects`, { headers: h });
  if (pRes.ok) {
    const projects = (await pRes.json())?.result || [];
    for (const project of projects) await cleanupPagesDeployments(cf.account_id, project.name, h);
  } else {
    const errText = await pRes.text();
    console.error(`  ❌ Failed to fetch CF Pages: ${pRes.status} ${pRes.statusText} - ${errText}`);
  }
}

async function cleanupWorkerDeployments(accountId, workerId, headers) {
  const res = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerId}/deployments`, { headers });
  if (!res.ok) return;
  const deps = (await res.json())?.result?.items || [];
  
  if (deps.length <= KEEP_COUNT) {
    console.log(`  ⚡ Worker [${workerId}]: Clean (${deps.length} found)`);
    return;
  }

  console.log(`  ⚡ Worker [${workerId}]: Found ${deps.length}. Deleting oldest ${deps.length - KEEP_COUNT}...`);
  for (let i = KEEP_COUNT; i < deps.length; i++) {
    const r = await fetch(`${CF_API}/accounts/${accountId}/workers/scripts/${workerId}/deployments/${deps[i].id}`, { method: "DELETE", headers });
    if (r.ok || r.status === 204) console.log(`      🗑️ Deleted Worker Deployment: ${deps[i].id}`);
    else console.error(`      ⚠️ Failed to delete Worker Deployment: ${deps[i].id} (${r.statusText})`);
    await delay(100);
  }
}

async function cleanupPagesDeployments(accountId, projectName, headers) {
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
    await delay(100);
  }

  allDeps.sort((a, b) => new Date(b.created_on) - new Date(a.created_on));

  if (allDeps.length <= KEEP_COUNT) {
    console.log(`  📄 Pages [${projectName}]: Clean (${allDeps.length} found)`);
    return;
  }

  console.log(`  📄 Pages [${projectName}]: Found ${allDeps.length}. Deleting oldest ${allDeps.length - KEEP_COUNT}...`);
  for (let i = KEEP_COUNT; i < allDeps.length; i++) {
    const r = await fetch(`${CF_API}/accounts/${accountId}/pages/projects/${projectName}/deployments/${allDeps[i].id}?force=true`, { method: "DELETE", headers });
    if (r.ok || r.status === 204) console.log(`      🗑️ Deleted Pages Deployment: ${allDeps[i].id}`);
    else if (r.status === 400 || r.status === 409) console.log(`      ⏭️ Skipped Active/Undeletable Pages Deployment: ${allDeps[i].id}`);
    else console.error(`      ⚠️ Failed to delete Pages Deployment: ${allDeps[i].id} (${r.statusText})`);
    await delay(100);
  }
}

// ── GITHUB LOGIC ──────────────────────────────────────────────────────
async function cleanupGitHubAccount(gh) {
  const h = { Authorization: `Bearer ${gh.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "TWDxHouseKeeping-Tools/1.0" };
  const repos = await fetchAllRepos(gh, h);
  
  for (const repo of repos) {
    console.log(`  📦 Repo [${repo.full_name}]`);
    await pruneGHDeployments(repo.full_name, h);
    await cleanupGitHubActions(repo.full_name, h); // Clean up Action history
    await delay(100);
  }
}

async function fetchAllRepos(gh, headers) {
  let repos = [];
  for (const org of gh.orgs || []) repos = repos.concat(await ghPaginate(`${GH_API}/orgs/${org}/repos?per_page=100&type=all`, headers));
  for (const user of gh.users || []) repos = repos.concat(await ghPaginate(`${GH_API}/users/${user}/repos?per_page=100&type=all`, headers));
  const seen = new Set();
  return repos.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
}

async function pruneGHDeployments(repo, headers) {
  const envRes = await fetch(`${GH_API}/repos/${repo}/environments`, { headers }).then(r => r.ok ? r.json() : null);
  const targets = (envRes?.environments || []).length > 0 ? envRes.environments.map(e => e.name) : [null];
  
  for (const envName of targets) {
    const qs = envName ? `?environment=${encodeURIComponent(envName)}&per_page=100` : "?per_page=100";
    const deps = await ghPaginate(`${GH_API}/repos/${repo}/deployments${qs}`, headers);
    
    if (deps.length > KEEP_COUNT) {
      console.log(`      Found ${deps.length} deployments in ${envName || 'default env'}. Deleting oldest ${deps.length - KEEP_COUNT}...`);
      for (let i = KEEP_COUNT; i < deps.length; i++) {
        await fetch(`${GH_API}/repos/${repo}/deployments/${deps[i].id}/statuses`, {
          method: "POST", headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ state: "inactive" }),
        }).catch(() => {});
        const r = await fetch(`${GH_API}/repos/${repo}/deployments/${deps[i].id}`, { method: "DELETE", headers });
        if (r.ok || r.status === 204) console.log(`      🗑️ Deleted GH Deployment: ${deps[i].id}`);
        await delay(100);
      }
    }
  }
}

async function cleanupGitHubActions(repo, headers) {
  const runsRes = await fetch(`${GH_API}/repos/${repo}/actions/runs?per_page=100`, { headers }).then(r => r.ok ? r.json() : null);
  const runs = runsRes?.workflow_runs || [];
  
  const currentRunId = process.env.GITHUB_RUN_ID;
  const pastRuns = runs.filter(r => r.id.toString() !== currentRunId)
                       .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (pastRuns.length <= KEEP_COUNT) return;

  const runsToDelete = pastRuns.slice(KEEP_COUNT);
  console.log(`      ⚡ Actions: Found ${runs.length} runs. Deleting oldest ${runsToDelete.length}...`);
  
  for (const run of runsToDelete) {
    const r = await fetch(`${GH_API}/repos/${repo}/actions/runs/${run.id}`, { method: "DELETE", headers });
    if (r.ok || r.status === 204) console.log(`      🗑️ Deleted Workflow Run: ${run.id} (${run.name})`);
    await delay(100);
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
    await delay(100);
  }
  return results;
}

// Start Execution
runCleanup();
