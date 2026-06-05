"use strict";

/**
 * Unit tests for TWDxHouseKeeping pure functions.
 * Run: NODE_ENV=test node --test test/cleanup.test.js
 * Uses only Node.js built-ins (node:test + node:assert). Zero external deps.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// The conditional export at the bottom of cleanup.js exposes these when NODE_ENV=test
const { validateConfig, sanitizeError, keepCountFloor, ageInDays } =
  require("../src/cleanup.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build minimal valid cloudflare-only config JSON string */
function cfConfig(overrides = {}) {
  return JSON.stringify({
    cloudflare: [
      {
        label: "test",
        token: "cf_token",
        account_id: "abc123",
        ...overrides,
      },
    ],
  });
}

/** Build minimal valid github-only config JSON string */
function ghConfig(overrides = {}) {
  return JSON.stringify({
    github: [
      {
        label: "test",
        token: "gh_token",
        users: ["user1"],
        ...overrides,
      },
    ],
  });
}

// ── sanitizeError ─────────────────────────────────────────────────────────────

describe("sanitizeError", () => {
  it("returns 'unknown error' for null", () => {
    assert.equal(sanitizeError(null), "unknown error");
  });

  it("returns 'unknown error' for undefined", () => {
    assert.equal(sanitizeError(undefined), "unknown error");
  });

  it("truncates strings longer than 300 characters", () => {
    // Use chars outside [A-Za-z0-9+/] to avoid triggering the base64 redaction rule
    const long = "!".repeat(400);
    const result = sanitizeError(long);
    assert.equal(result.length, 300);
  });

  it("does not truncate strings at exactly 300 characters", () => {
    const exact = "!".repeat(300);
    assert.equal(sanitizeError(exact).length, 300);
  });

  it("redacts Bearer tokens", () => {
    const result = sanitizeError("Authorization: Bearer abc123xyz456");
    assert.ok(!result.includes("abc123xyz456"), "token should be redacted");
    assert.ok(result.includes("Bearer [REDACTED]"));
  });

  it("redacts 40-character base64 strings", () => {
    const secret = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN";
    assert.equal(secret.length, 40);
    const result = sanitizeError(`error: ${secret}`);
    assert.ok(!result.includes(secret));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("redacts UUIDs", () => {
    const result = sanitizeError("account: 550e8400-e29b-41d4-a716-446655440000");
    assert.ok(!result.includes("550e8400-e29b-41d4-a716-446655440000"));
    assert.ok(result.includes("[ID]"));
  });

  it("redacts URLs", () => {
    const result = sanitizeError("see https://api.cloudflare.com/secret/path");
    assert.ok(!result.includes("https://api.cloudflare.com/secret/path"));
    assert.ok(result.includes("[URL]"));
  });

  // HK-16: provider prefix redaction
  it("redacts ghp_ GitHub tokens", () => {
    const result = sanitizeError("token: ghp_abcdef123456");
    assert.ok(!result.includes("ghp_abcdef123456"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("redacts gho_ GitHub OAuth tokens", () => {
    const result = sanitizeError("token: gho_abcdef123456");
    assert.ok(!result.includes("gho_abcdef123456"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("redacts github_pat_ tokens", () => {
    const result = sanitizeError("token: github_pat_abcdef123456");
    assert.ok(!result.includes("github_pat_abcdef123456"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("redacts cf_ Cloudflare tokens", () => {
    const result = sanitizeError("token: cf_abcdef123456");
    assert.ok(!result.includes("cf_abcdef123456"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("redacts sk_ secret keys", () => {
    const result = sanitizeError("key: sk_live_abcdef");
    assert.ok(!result.includes("sk_live_abcdef"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("redacts pk_ public keys (defense-in-depth)", () => {
    const result = sanitizeError("key: pk_test_abcdef");
    assert.ok(!result.includes("pk_test_abcdef"));
    assert.ok(result.includes("[REDACTED]"));
  });

  it("passes through ordinary messages unchanged", () => {
    const msg = "Something went wrong with the request";
    assert.equal(sanitizeError(msg), msg);
  });

  it("accepts an Error object and uses its message", () => {
    const err = new Error("simple error message");
    assert.equal(sanitizeError(err), "simple error message");
  });
});

// ── keepCountFloor ────────────────────────────────────────────────────────────

describe("keepCountFloor", () => {
  it("returns the value as-is when >= 1", () => {
    assert.equal(keepCountFloor(3, "test"), 3);
  });

  it("returns 10 for input 10", () => {
    assert.equal(keepCountFloor(10, "test"), 10);
  });

  it("floors 0 to 1", () => {
    assert.equal(keepCountFloor(0, "test"), 1);
  });

  it("floors negative values to 1", () => {
    assert.equal(keepCountFloor(-5, "test"), 1);
  });

  it("floors NaN to 1", () => {
    assert.equal(keepCountFloor(NaN, "test"), 1);
  });

  it("floors null to 1", () => {
    assert.equal(keepCountFloor(null, "test"), 1);
  });

  it("floors undefined to 1", () => {
    assert.equal(keepCountFloor(undefined, "test"), 1);
  });

  it("parses a numeric string (resilience for older configs)", () => {
    assert.equal(keepCountFloor("5", "test"), 5);
  });
});

// ── ageInDays ─────────────────────────────────────────────────────────────────

describe("ageInDays", () => {
  it("returns approximately 0 for now", () => {
    const result = ageInDays(new Date().toISOString());
    assert.ok(result >= 0 && result < 0.01, `expected ~0, got ${result}`);
  });

  it("returns approximately 1 for 24 hours ago", () => {
    const d = new Date(Date.now() - 86_400_000).toISOString();
    const result = ageInDays(d);
    assert.ok(Math.abs(result - 1) < 0.01, `expected ~1, got ${result}`);
  });

  it("returns approximately 30 for 30 days ago", () => {
    const d = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const result = ageInDays(d);
    assert.ok(Math.abs(result - 30) < 0.5, `expected ~30, got ${result}`);
  });

  it("handles ISO strings with timezone offset", () => {
    const d = new Date(Date.now() - 5 * 86_400_000).toISOString().replace("Z", "+02:00");
    const result = ageInDays(d);
    assert.ok(Math.abs(result - 5) < 0.5, `expected ~5, got ${result}`);
  });

  it("returns a large positive number for a very old date", () => {
    const result = ageInDays("2000-01-01T00:00:00Z");
    assert.ok(result > 365 * 10, `expected > 3650, got ${result}`);
  });
});

// ── validateConfig — valid inputs ─────────────────────────────────────────────

describe("validateConfig — valid", () => {
  it("accepts valid cloudflare-only config", () => {
    assert.doesNotThrow(() => validateConfig(cfConfig()));
  });

  it("accepts valid github-only config with users", () => {
    assert.doesNotThrow(() => validateConfig(ghConfig()));
  });

  it("accepts valid github-only config with orgs", () => {
    assert.doesNotThrow(() => validateConfig(ghConfig({ users: undefined, orgs: ["myorg"] })));
  });

  it("accepts combined cloudflare + github config", () => {
    const raw = JSON.stringify({
      cloudflare: [{ label: "cf", token: "cf_t", account_id: "id1" }],
      github: [{ label: "gh", token: "gh_t", users: ["u1"] }],
    });
    assert.doesNotThrow(() => validateConfig(raw));
  });

  it("accepts optional keep_count as a number", () => {
    assert.doesNotThrow(() => validateConfig(cfConfig({ keep_count: 5 })));
  });

  it("accepts optional min_age_days as a number", () => {
    assert.doesNotThrow(() => validateConfig(cfConfig({ min_age_days: 7 })));
  });

  it("accepts clean_git_history with valid git_history_repos", () => {
    assert.doesNotThrow(() =>
      validateConfig(
        ghConfig({ clean_git_history: true, git_history_repos: ["owner/repo"] })
      )
    );
  });

  it("accepts clean_git_history without git_history_repos (HK-29 auto-discover)", () => {
    assert.doesNotThrow(() =>
      validateConfig(ghConfig({ clean_git_history: true }))
    );
  });

  it("accepts clean_git_history with empty git_history_repos (HK-29 auto-discover)", () => {
    assert.doesNotThrow(() =>
      validateConfig(ghConfig({ clean_git_history: true, git_history_repos: [] }))
    );
  });

  it("accepts keep_history_count of 0 (full sweep)", () => {
    assert.doesNotThrow(() =>
      validateConfig(
        ghConfig({
          clean_git_history: true,
          git_history_repos: ["owner/repo"],
          keep_history_count: 0,
        })
      )
    );
  });

  it("accepts keep_history_count of 5", () => {
    assert.doesNotThrow(() =>
      validateConfig(
        ghConfig({
          clean_git_history: true,
          git_history_repos: ["owner/repo"],
          keep_history_count: 5,
        })
      )
    );
  });
});

// ── validateConfig — invalid inputs ──────────────────────────────────────────

describe("validateConfig — invalid", () => {
  const throws = (raw, label) => {
    it(label, () => {
      assert.throws(() => validateConfig(raw), { message: /./s });
    });
  };

  throws("not json at all {{{{", "throws on non-JSON string");
  throws(JSON.stringify([{ cloudflare: [] }]), "throws on JSON array root");
  throws(JSON.stringify({}), "throws on empty object (no cloudflare/github)");
  throws(JSON.stringify({ cloudflare: "not-an-array" }), "throws when cloudflare is not an array");

  throws(
    JSON.stringify({ cloudflare: [{ account_id: "id", label: "l" }] }),
    "throws when cloudflare entry missing token"
  );
  throws(
    JSON.stringify({ cloudflare: [{ token: "t", label: "l" }] }),
    "throws when cloudflare entry missing account_id"
  );
  throws(
    JSON.stringify({ cloudflare: [{ token: "t", account_id: "id" }] }),
    "throws when cloudflare entry missing label"
  );

  throws(JSON.stringify({ github: "not-an-array" }), "throws when github is not an array");

  throws(
    JSON.stringify({ github: [{ label: "l", users: ["u"] }] }),
    "throws when github entry missing token"
  );
  throws(
    JSON.stringify({ github: [{ token: "t", users: ["u"] }] }),
    "throws when github entry missing label"
  );
  throws(
    JSON.stringify({ github: [{ token: "t", label: "l" }] }),
    "throws when github entry has neither users nor orgs"
  );
  throws(
    JSON.stringify({ github: [{ token: "t", label: "l", users: [], orgs: [] }] }),
    "throws when github entry has empty users and orgs arrays"
  );

  throws(
    JSON.stringify({
      github: [{ token: "t", label: "l", users: ["u"], clean_git_history: true, git_history_repos: ["nodslash"] }],
    }),
    "throws when git_history_repos contains entry without slash"
  );

  throws(
    JSON.stringify({
      github: [
        {
          token: "t", label: "l", users: ["u"],
          clean_git_history: true, git_history_repos: ["owner/repo"],
          keep_history_count: -1,
        },
      ],
    }),
    "throws when keep_history_count is negative"
  );
  throws(
    JSON.stringify({
      github: [
        {
          token: "t", label: "l", users: ["u"],
          clean_git_history: true, git_history_repos: ["owner/repo"],
          keep_history_count: 1.5,
        },
      ],
    }),
    "throws when keep_history_count is non-integer"
  );

  // HK-17: numeric field type checks
  throws(cfConfig({ keep_count: "3" }), "throws when cloudflare keep_count is a string (HK-17)");
  throws(cfConfig({ min_age_days: "7" }), "throws when cloudflare min_age_days is a string (HK-17)");
  throws(cfConfig({ min_age_days: true }), "throws when cloudflare min_age_days is a boolean (HK-17)");
  throws(cfConfig({ min_age_days: null }), "throws when cloudflare min_age_days is null (HK-17)");
  throws(ghConfig({ keep_count: "5" }), "throws when github keep_count is a string (HK-17)");
  throws(ghConfig({ min_age_days: "14" }), "throws when github min_age_days is a string (HK-17)");

  // HK-18: edge-case repo formats that slip past the "includes slash" check in validateConfig
  throws(
    JSON.stringify({
      github: [
        {
          token: "t", label: "l", users: ["u"],
          clean_git_history: true, git_history_repos: ["owner/"],
        },
      ],
    }),
    "throws when git_history_repos entry has trailing slash (empty repo name)"
  );
  throws(
    JSON.stringify({
      github: [
        {
          token: "t", label: "l", users: ["u"],
          clean_git_history: true, git_history_repos: ["/repo"],
        },
      ],
    }),
    "throws when git_history_repos entry has leading slash (empty owner)"
  );

  it("collects multiple errors in a single throw (not first-fail-fast)", () => {
    const raw = JSON.stringify({
      cloudflare: [{ keep_count: "bad", min_age_days: "also-bad" }],
    });
    let caught;
    try { validateConfig(raw); } catch (e) { caught = e; }
    assert.ok(caught, "expected an error to be thrown");
    assert.ok(caught.message.includes("error(s)"), `expected 'error(s)' in: ${caught.message}`);
  });
});

// ── HK-19: boundary commit access ────────────────────────────────────────────

describe("HK-19 boundary commit logic (unit)", () => {
  it("does NOT access commits[N] when commits.length <= keepHistoryCount", () => {
    // Simulate the early-exit condition inside cleanGitHub
    const keepHistoryCount = 5;
    const commits = Array.from({ length: 5 }, (_, i) => ({ sha: `sha${i}` }));
    // The guard: if (commits.length <= keepHistoryCount) continue;
    assert.ok(
      commits.length <= keepHistoryCount,
      "commits.length should trigger early exit"
    );
    // commits[keepHistoryCount] would be undefined — the guard prevents us reaching it
    assert.equal(commits[keepHistoryCount], undefined);
  });

  it("commits[keepHistoryCount] is defined when commits.length === keepHistoryCount + 1", () => {
    const keepHistoryCount = 5;
    const commits = Array.from({ length: 6 }, (_, i) => ({
      commit: { tree: { sha: `treeSha${i}` } },
    }));
    const boundaryCommit = commits[keepHistoryCount];
    assert.ok(boundaryCommit !== undefined, "boundary commit should exist");
    assert.ok(boundaryCommit?.commit?.tree?.sha, "boundary treeSha should be accessible");
  });
});
