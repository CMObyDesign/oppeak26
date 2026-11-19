// Per-IP rate limit on unauthenticated Claude-calling audit routes
// (security review 2026-11-19). Uses node:sqlite with the real migration so
// the UPSERT ... RETURNING statement is exercised against SQLite.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import worker, { checkAuditRateLimit } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// node:sqlite is unflagged from Node 22.13; skip the suite on older runtimes.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import("node:sqlite")); } catch { DatabaseSync = null; }
const skip = DatabaseSync ? false : "node:sqlite unavailable on this Node version";

const MIGRATION = readFileSync(path.join(here, "..", "migrations", "0010_rate_limits.sql"), "utf8");

function makeD1({ migrate = true } = {}) {
  const db = new DatabaseSync(":memory:");
  if (migrate) db.exec(MIGRATION);
  return {
    prepare(sql) {
      let args = [];
      const stmt = {
        bind(...a) { args = a; return stmt; },
        async first() { return db.prepare(sql).get(...args) ?? null; },
        async run() { db.prepare(sql).run(...args); return { success: true }; },
        async all() { return { results: db.prepare(sql).all(...args) }; },
      };
      return stmt;
    },
  };
}

function req(ip, p = "/marketing/render?url=example.com") {
  return new Request(`https://swot-engine.test${p}`, { headers: { "CF-Connecting-IP": ip } });
}

describe("checkAuditRateLimit", { skip }, () => {
  it("allows up to the limit per IP, then limits", async () => {
    const env = { SOLOMON_DB: makeD1(), AUDIT_RATE_LIMIT_PER_HOUR: "3" };
    for (let i = 0; i < 3; i++) {
      assert.equal((await checkAuditRateLimit(req("1.1.1.1"), env, {})).limited, false);
    }
    const r = await checkAuditRateLimit(req("1.1.1.1"), env, {});
    assert.equal(r.limited, true);
    assert.ok(r.retryAfter > 0 && r.retryAfter <= 3600);
    // A different IP has its own budget.
    assert.equal((await checkAuditRateLimit(req("2.2.2.2"), env, {})).limited, false);
  });

  it("fails open with no D1 binding or no table", async () => {
    assert.equal((await checkAuditRateLimit(req("1.1.1.1"), {}, {})).limited, false);
    const env = { SOLOMON_DB: makeD1({ migrate: false }) };
    const r = await checkAuditRateLimit(req("1.1.1.1"), env, {});
    assert.equal(r.limited, false);
    assert.equal(r.skipped, "d1_error");
  });
});

describe("routes return 429 once over the limit (no Claude call)", { skip }, () => {
  it("GET /marketing/render", async () => {
    let claudeCalls = 0;
    const env = {
      SOLOMON_DB: makeD1(),
      AUDIT_RATE_LIMIT_PER_HOUR: "1",
      __CLAUDE_STUB__: async () => { claudeCalls++; throw new Error("stop"); },
    };
    // Prime the bucket so the next call is over the limit.
    await checkAuditRateLimit(req("9.9.9.9"), env, {});
    const before = claudeCalls;
    const res = await worker.fetch(req("9.9.9.9"), env, { waitUntil() {} });
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("Retry-After"));
    assert.equal(claudeCalls, before);
  });

  it("POST /audit", async () => {
    const env = { SOLOMON_DB: makeD1(), AUDIT_RATE_LIMIT_PER_HOUR: "1" };
    await checkAuditRateLimit(req("8.8.8.8"), env, {});
    const res = await worker.fetch(new Request("https://swot-engine.test/audit", {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "8.8.8.8" },
      body: JSON.stringify({ url: "example.com" }),
    }), env, { waitUntil() {} });
    assert.equal(res.status, 429);
    assert.equal((await res.json()).success, false);
  });
});
