// Slice E regression tests — catalog-ref audit + backfill handler.
//
// Covers:
//   1. Both handlers 401 without the console password header.
//   2. /audit: 503 when D1 is missing.
//   3. /audit: classifies cohort into pinned_known / pinned_unknown /
//      unpinned buckets per contact and returns per-row items.
//   4. /audit: empty cohort → zero-everything.
//   5. /audit/backfill validates inputs (contactId / by /
//      catalogVersionId positive integer).
//   6. /audit/backfill 404s on an unknown catalog version id.
//   7. /audit/backfill writes the catalog_ref field via the sanctioned
//      wrapper and reports success + the resolved services_sha.
//
// The audit's GHL cohort fetch is stubbed via globalThis.fetch; the
// GHL fields catalog is stubbed via env.GHL_CUSTOM_FIELDS_CATALOG
// (same hook `fetchGHLCustomFieldsCatalog` already honors).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  handleAuditCatalogRefs,
  handleBackfillCatalogRef,
} from "../src/bga_copilot/catalog_audit.js";

const CATALOG_REF_FIELD_KEY = "swot_bga_services_catalog_ref";
const PAID_297_TAG = "swot_paid_297";
const FIELD_ID = "fld_catalog_ref_id";
const HISTORY_FIELD_ID = "fld_history_id";

// Minimal fake D1 — supports the two queries the audit handlers use.
function makeFakeDb({ versions = [] } = {}) {
  const state = { versions: [...versions], writes: 0 };
  function prepare(sql) {
    if (/FROM bga_catalog_versions WHERE id = \?/i.test(sql)) {
      return {
        bind: (id) => ({
          first: async () => state.versions.find((v) => v.id === id) || null,
        }),
      };
    }
    if (/SELECT services_sha FROM bga_catalog_versions$/i.test(sql.trim())) {
      return { all: async () => ({ results: state.versions.map((v) => ({ services_sha: v.services_sha })) }) };
    }
    throw new Error(`fake D1 unexpected SQL: ${sql.slice(0, 100)}`);
  }
  return { prepare, _state: state };
}

// Builds a GHL contact fixture with a specific catalog_ref value (or
// no catalog_ref field at all). The GHL custom-field catalog is
// matched by fieldKey OR id, so we populate both.
function contactFixture({ id, catalogRef = undefined, name = "T", company = "C" }) {
  const cfs = [];
  if (typeof catalogRef !== "undefined") {
    cfs.push({ id: FIELD_ID, fieldKey: `contact.${CATALOG_REF_FIELD_KEY}`, value: catalogRef });
  }
  return {
    id,
    contactName: name,
    companyName: company,
    email: `${id}@test`,
    tags: [PAID_297_TAG],
    customFields: cfs,
    dateUpdated: "2026-10-18T00:00:00Z",
  };
}

const OK  = { checkPassword: () => true };
const BAD = { checkPassword: () => false };

function postReq(body) {
  return new Request("http://x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
}

async function readJson(resp) {
  const t = await resp.text();
  try { return JSON.parse(t); } catch { return { __raw: t }; }
}

// GHL fetch stub. Routes:
//   POST /contacts/search       → cohort fetch
//   GET  /locations/.../customFields → fields catalog
//   PUT  /contacts/{id}         → upsert on backfill
let fetchCalls = [];
function installGhlStub({ cohort = [], putOk = true } = {}) {
  const original = globalThis.fetch;
  fetchCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    fetchCalls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith("/contacts/search")) {
      return new Response(JSON.stringify({ contacts: cohort }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/customFields") && (init.method || "GET") === "GET") {
      return new Response(JSON.stringify({
        customFields: [
          { id: FIELD_ID, fieldKey: `contact.${CATALOG_REF_FIELD_KEY}` },
          { id: HISTORY_FIELD_ID, fieldKey: `contact.swot_bga_version_history` },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Single-contact GET during the sanctioned-wrapper history read.
    if (/\/contacts\/[^/]+$/.test(u) && (init.method || "GET") === "GET") {
      const id = u.split("/").pop();
      return new Response(JSON.stringify({
        contact: { id, customFields: [] },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Single-contact PUT = write path.
    if (/\/contacts\/[^/]+$/.test(u) && (init.method || "").toUpperCase() === "PUT") {
      if (!putOk) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ contact: {} }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("unexpected", { status: 418 });
  };
  return () => { globalThis.fetch = original; };
}

const ENV_BASE = {
  GHL_API_KEY:     "k",
  GHL_LOCATION_ID: "loc",
};

describe("catalog_audit handlers (slice E)", () => {
  let restore;
  afterEach(() => { if (restore) restore(); restore = null; });

  it("1. both handlers 401 without the password header", async () => {
    const env = { ...ENV_BASE, SOLOMON_DB: makeFakeDb() };
    const r1 = await handleAuditCatalogRefs(postReq({}), env, BAD);
    const r2 = await handleBackfillCatalogRef(postReq({ contactId: "c1", catalogVersionId: 1, by: "x" }), env, BAD);
    assert.equal(r1.status, 401);
    assert.equal(r2.status, 401);
  });

  it("2. /audit returns 503 when D1 is missing", async () => {
    restore = installGhlStub({ cohort: [] });
    const r = await handleAuditCatalogRefs(postReq({}), { ...ENV_BASE }, OK);
    assert.equal(r.status, 503);
  });

  it("3. /audit classifies cohort into pinned_known / pinned_unknown / unpinned", async () => {
    const cohort = [
      contactFixture({ id: "c1", catalogRef: "abc123known" }),
      contactFixture({ id: "c2", catalogRef: "deadbeeffoo" }),
      contactFixture({ id: "c3" }), // no catalog_ref field
    ];
    restore = installGhlStub({ cohort });
    const env = { ...ENV_BASE, SOLOMON_DB: makeFakeDb({ versions: [
      { id: 1, services_sha: "abc123known" },
      { id: 2, services_sha: "cafef00dcafe" },
    ] }) };
    const r = await handleAuditCatalogRefs(postReq({}), env, OK);
    assert.equal(r.status, 200);
    const b = await readJson(r);
    assert.equal(b.success, true);
    assert.equal(b.totals.scanned, 3);
    assert.equal(b.totals.pinned_known, 1);
    assert.equal(b.totals.pinned_unknown, 1);
    assert.equal(b.totals.unpinned, 1);
    assert.equal(b.knownVersionCount, 2);
    const byId = new Map(b.items.map((i) => [i.contactId, i]));
    assert.equal(byId.get("c1").bucket, "pinned_known");
    assert.equal(byId.get("c2").bucket, "pinned_unknown");
    assert.equal(byId.get("c3").bucket, "unpinned");
    assert.equal(byId.get("c3").catalogRef, null);
  });

  it("4. /audit on an empty cohort returns zero-everything", async () => {
    restore = installGhlStub({ cohort: [] });
    const env = { ...ENV_BASE, SOLOMON_DB: makeFakeDb({ versions: [{ id: 1, services_sha: "x" }] }) };
    const b = await readJson(await handleAuditCatalogRefs(postReq({}), env, OK));
    assert.equal(b.success, true);
    assert.equal(b.totals.scanned, 0);
    assert.equal(b.totals.pinned_known, 0);
    assert.equal(b.totals.pinned_unknown, 0);
    assert.equal(b.totals.unpinned, 0);
    assert.equal(b.items.length, 0);
  });

  it("5. /audit/backfill validates inputs", async () => {
    const env = { ...ENV_BASE, SOLOMON_DB: makeFakeDb() };
    for (const [body, pat] of [
      [{}, /contactId required/],
      [{ contactId: "c1" }, /by \(operator identifier\) required/],
      [{ contactId: "c1", by: "x" }, /catalogVersionId must be a positive integer/],
      [{ contactId: "c1", by: "x", catalogVersionId: -2 }, /catalogVersionId must be a positive integer/],
    ]) {
      const r = await handleBackfillCatalogRef(postReq(body), env, OK);
      assert.equal(r.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      const parsed = await readJson(r);
      assert.match(parsed.error, pat);
    }
  });

  it("6. /audit/backfill 404s on an unknown catalog version id", async () => {
    const env = { ...ENV_BASE, SOLOMON_DB: makeFakeDb({ versions: [{ id: 1, services_sha: "abc" }] }) };
    const r = await handleBackfillCatalogRef(postReq({
      contactId: "c1", catalogVersionId: 99, by: "x",
    }), env, OK);
    assert.equal(r.status, 404);
    const b = await readJson(r);
    assert.match(b.error, /catalog version 99 not found/);
  });

  it("7. /audit/backfill happy path writes the field and reports success", async () => {
    restore = installGhlStub({ cohort: [], putOk: true });
    const env = { ...ENV_BASE, SOLOMON_DB: makeFakeDb({ versions: [{ id: 5, services_sha: "deadbeef1234" }] }) };
    const r = await handleBackfillCatalogRef(postReq({
      contactId: "c1", catalogVersionId: 5, by: "liz@x", note: "post-slice-A audit sweep",
    }), env, OK);
    assert.equal(r.status, 200);
    const b = await readJson(r);
    assert.equal(b.success, true);
    assert.equal(b.contactId, "c1");
    assert.equal(b.catalogVersionId, 5);
    assert.equal(b.services_sha, "deadbeef1234");
    // The wrapper issues a PUT on /contacts/c1.
    const put = fetchCalls.find((f) => /\/contacts\/c1$/.test(f.url) && (f.init.method || "").toUpperCase() === "PUT");
    assert.ok(put, "expected a PUT /contacts/c1 to be issued");
  });
});
