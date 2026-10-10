// BGA Copilot — version_history wrapper tests (PR 10).
//
// Pins the §8 guardrails for the shared write path:
//   - Every tool call appends one entry per affected field to
//     swot_bga_version_history.
//   - Data fields + history field land in a single atomic PUT.
//   - Entries have the §8.1 shape (at, actor, action, affected_field,
//     snapshot_hash, catalog_ref?).
//   - Spillover: when combined length exceeds HISTORY_CAP (50), the
//     oldest overflow is written to R2 under bga_audit/<contactId>/<yyyy-mm>.json,
//     grouped by month, and the field keeps the trimmed newest HISTORY_CAP.
//   - Fail closed when overflow would occur but BGA_AUDIT R2 binding
//     is missing — never silently drop audit entries.
//   - §9 guardrail 15 (version history appends on every tool call) —
//     three different tools, log length grows, order preserved.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  HISTORY_FIELD_KEY,
  HISTORY_CAP,
  SPILLOVER_PREFIX,
  ACTOR_CONSOLE_SESSION,
  computeSnapshotHash,
  parseVersionHistory,
  spillOverflow,
  buildHistoryEntries,
  writeFieldsAndAppendHistory,
} from "../src/bga_copilot/version_history.js";
import { _resetCatalogCacheForTests } from "../src/ghl_catalog.js";

beforeEach(() => {
  _resetCatalogCacheForTests();
});

function makeEnv(overrides = {}) {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    ...overrides,
  };
}

function stubFetch(responder) {
  const orig = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return responder(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

function ghlContactRes(opts = {}) {
  const { customFields = [], tags = ["swot_paid_297"] } = opts;
  return new Response(
    JSON.stringify({ contact: { id: "c1", tags, customFields } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function emptyCatalogRes() {
  return new Response(JSON.stringify({ customFields: [] }), { status: 200 });
}

// Minimal in-memory R2 stub matching the subset of the binding our
// wrapper uses (.get → { json() }, .put(key, value)).
function makeR2Stub() {
  const store = new Map();
  return {
    store,
    binding: {
      async get(key) {
        if (!store.has(key)) return null;
        const value = store.get(key);
        return {
          async json() { return JSON.parse(value); },
          async text() { return value; },
        };
      },
      async put(key, value /*, opts */) {
        store.set(key, value);
        return { key, etag: "stub" };
      },
    },
  };
}

describe("parseVersionHistory", () => {
  it("returns [] for empty / missing / non-string", () => {
    assert.deepEqual(parseVersionHistory(""), []);
    assert.deepEqual(parseVersionHistory(null), []);
    assert.deepEqual(parseVersionHistory(undefined), []);
    assert.deepEqual(parseVersionHistory(123), []);
  });

  it("returns [] for malformed JSON", () => {
    assert.deepEqual(parseVersionHistory("{not json"), []);
    assert.deepEqual(parseVersionHistory("{}"), []); // non-array
  });

  it("returns the parsed array for valid JSON array", () => {
    const entries = [{ at: "2026-10-09T14:00:00Z", action: "x" }];
    assert.deepEqual(parseVersionHistory(JSON.stringify(entries)), entries);
  });
});

describe("computeSnapshotHash", () => {
  it("returns 'sha256:' + 16 hex chars", async () => {
    const h = await computeSnapshotHash("hello world");
    assert.match(h, /^sha256:[0-9a-f]{16}$/);
  });

  it("is deterministic for the same input", async () => {
    const a = await computeSnapshotHash("some draft content");
    const b = await computeSnapshotHash("some draft content");
    assert.equal(a, b);
  });

  it("differs for different inputs", async () => {
    const a = await computeSnapshotHash("content A");
    const b = await computeSnapshotHash("content B");
    assert.notEqual(a, b);
  });
});

describe("buildHistoryEntries", () => {
  it("builds one entry per affected field with the §8.1 shape", async () => {
    const at = "2026-10-09T14:32:11Z";
    const entries = await buildHistoryEntries({
      action: "generate_roadmap_draft",
      affectedFields: ["swot_growth_plan_draft", "swot_bga_services_catalog_ref"],
      fieldWrites: [
        { key: "swot_growth_plan_draft", value: "DRAFT BODY" },
        { key: "swot_bga_services_catalog_ref", value: "abc123def456" },
      ],
      catalogRef: "abc123def456",
      at,
    });
    assert.equal(entries.length, 2);
    for (const e of entries) {
      assert.equal(e.at, at);
      assert.equal(e.actor, ACTOR_CONSOLE_SESSION);
      assert.equal(e.action, "generate_roadmap_draft");
      assert.match(e.snapshot_hash, /^sha256:[0-9a-f]{16}$/);
      assert.equal(e.catalog_ref, "abc123def456");
    }
    assert.equal(entries[0].affected_field, "swot_growth_plan_draft");
    assert.equal(entries[1].affected_field, "swot_bga_services_catalog_ref");
  });

  it("omits catalog_ref when not supplied", async () => {
    const entries = await buildHistoryEntries({
      action: "verified_financials_panel",
      affectedFields: ["swot_verified_financials"],
      fieldWrites: [{ key: "swot_verified_financials", value: "[]" }],
    });
    assert.equal(entries.length, 1);
    assert.ok(!("catalog_ref" in entries[0]));
  });
});

describe("spillOverflow", () => {
  it("returns everything in kept and spills 0 when under cap", async () => {
    const entries = Array.from({ length: HISTORY_CAP }, (_, i) => ({
      at: "2026-10-09T14:00:00Z", action: "x", affected_field: `f${i}`,
    }));
    const r2 = makeR2Stub();
    const { kept, spilled } = await spillOverflow(entries, "c1", makeEnv({ BGA_AUDIT: r2.binding }));
    assert.equal(kept.length, HISTORY_CAP);
    assert.equal(spilled, 0);
    assert.equal(r2.store.size, 0, "no R2 writes when under cap");
  });

  it("writes overflow to R2 grouped by yyyy-mm month", async () => {
    // 52 entries: 2 in September, 50 in October. HISTORY_CAP=50, so the
    // 2 September entries are the overflow.
    const entries = [
      { at: "2026-09-30T14:00:00Z", action: "a1", affected_field: "f" },
      { at: "2026-09-30T15:00:00Z", action: "a2", affected_field: "f" },
      ...Array.from({ length: 50 }, (_, i) => ({
        at: `2026-10-01T14:00:${String(i).padStart(2, "0")}Z`,
        action: "oct",
        affected_field: "f",
      })),
    ];
    const r2 = makeR2Stub();
    const { kept, spilled } = await spillOverflow(
      entries,
      "contact_abc",
      makeEnv({ BGA_AUDIT: r2.binding }),
    );
    assert.equal(kept.length, HISTORY_CAP);
    assert.equal(spilled, 2);

    const sepKey = `${SPILLOVER_PREFIX}/contact_abc/2026-09.json`;
    assert.ok(r2.store.has(sepKey), "september overflow file was written");
    const sepData = JSON.parse(r2.store.get(sepKey));
    assert.equal(sepData.length, 2);
    assert.equal(sepData[0].action, "a1");
    assert.equal(sepData[1].action, "a2");
    // Only the overflow (September) wrote; the newest 50 stayed in the field.
    assert.ok(!r2.store.has(`${SPILLOVER_PREFIX}/contact_abc/2026-10.json`));
  });

  it("appends to an existing month file (preserves prior overflow)", async () => {
    const r2 = makeR2Stub();
    r2.store.set(
      `${SPILLOVER_PREFIX}/c1/2026-09.json`,
      JSON.stringify([{ at: "2026-09-01T00:00:00Z", action: "earlier" }]),
    );
    // Now overflow one more September entry.
    const entries = [
      { at: "2026-09-15T14:00:00Z", action: "newer" },
      ...Array.from({ length: HISTORY_CAP }, () => ({
        at: "2026-10-01T14:00:00Z", action: "cap",
      })),
    ];
    await spillOverflow(entries, "c1", makeEnv({ BGA_AUDIT: r2.binding }));
    const stored = JSON.parse(r2.store.get(`${SPILLOVER_PREFIX}/c1/2026-09.json`));
    assert.equal(stored.length, 2);
    assert.equal(stored[0].action, "earlier");
    assert.equal(stored[1].action, "newer");
  });

  it("fails closed when overflow would occur but BGA_AUDIT is missing", async () => {
    const entries = Array.from({ length: HISTORY_CAP + 1 }, () => ({
      at: "2026-10-09T14:00:00Z", action: "x",
    }));
    await assert.rejects(
      spillOverflow(entries, "c1", makeEnv({})),
      /BGA_AUDIT R2 binding not configured/,
    );
  });
});

describe("writeFieldsAndAppendHistory", () => {
  it("PUTs data fields + history in a single request and appends one entry per affected field", async () => {
    let putBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) {
        return emptyCatalogRes();
      }
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return ghlContactRes({ customFields: [] });
    });
    try {
      const res = await writeFieldsAndAppendHistory({
        contactId: "c1",
        fieldWrites: [
          { key: "swot_growth_plan_draft", value: "DRAFT BODY" },
          { key: "swot_bga_services_catalog_ref", value: "abc123def456" },
        ],
        action: "generate_roadmap_draft",
        affectedFields: ["swot_growth_plan_draft", "swot_bga_services_catalog_ref"],
        catalogRef: "abc123def456",
        historyRaw: "", // caller-supplied; wrapper does not refetch
        env: makeEnv(),
      });
      assert.equal(res.success, true);
      assert.equal(res.entries_appended, 2);
      assert.equal(res.spilled_count, 0);
      // PUT body shape — data fields + history field, all in one request.
      assert.ok(putBody && Array.isArray(putBody.customFields));
      const keys = putBody.customFields.map((f) => f.key).sort();
      assert.deepEqual(keys, [
        "swot_bga_services_catalog_ref",
        "swot_bga_version_history",
        "swot_growth_plan_draft",
      ]);
      const historyField = putBody.customFields.find((f) => f.key === HISTORY_FIELD_KEY);
      const entries = JSON.parse(historyField.field_value);
      assert.equal(entries.length, 2);
      for (const e of entries) {
        assert.equal(e.actor, ACTOR_CONSOLE_SESSION);
        assert.equal(e.action, "generate_roadmap_draft");
        assert.equal(e.catalog_ref, "abc123def456");
        assert.match(e.snapshot_hash, /^sha256:[0-9a-f]{16}$/);
      }
    } finally { cap.restore(); }
  });

  it("preserves existing history entries — new entries append (ordering preserved)", async () => {
    const existingEntries = [
      {
        at: "2026-10-08T14:00:00Z",
        actor: ACTOR_CONSOLE_SESSION,
        action: "verified_financials_panel",
        affected_field: "swot_verified_financials",
        snapshot_hash: "sha256:0000000000000000",
      },
    ];
    let putBody = null;
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return emptyCatalogRes();
    });
    try {
      await writeFieldsAndAppendHistory({
        contactId: "c1",
        fieldWrites: [{ key: "swot_bga_prep_brief", value: "BRIEF" }],
        action: "generate_prep_brief",
        affectedFields: ["swot_bga_prep_brief"],
        historyRaw: JSON.stringify(existingEntries),
        env: makeEnv(),
      });
      const stored = JSON.parse(
        putBody.customFields.find((f) => f.key === HISTORY_FIELD_KEY).field_value,
      );
      assert.equal(stored.length, 2);
      // Old entry first, new entry last.
      assert.equal(stored[0].action, "verified_financials_panel");
      assert.equal(stored[1].action, "generate_prep_brief");
    } finally { cap.restore(); }
  });

  it("returns 503 when GHL writeback fails", async () => {
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") {
        return new Response("", { status: 500 });
      }
      return emptyCatalogRes();
    });
    try {
      const res = await writeFieldsAndAppendHistory({
        contactId: "c1",
        fieldWrites: [{ key: "swot_bga_prep_brief", value: "BRIEF" }],
        action: "generate_prep_brief",
        affectedFields: ["swot_bga_prep_brief"],
        historyRaw: "",
        env: makeEnv(),
      });
      assert.equal(res.success, false);
      assert.equal(res.status, 503);
    } finally { cap.restore(); }
  });

  it("validates inputs — missing contactId / action / fieldWrites / affectedFields", async () => {
    const base = {
      fieldWrites: [{ key: "x", value: "y" }],
      action: "x",
      affectedFields: ["x"],
      historyRaw: "",
      env: makeEnv(),
    };
    assert.equal(
      (await writeFieldsAndAppendHistory({ ...base, contactId: "" })).success,
      false,
    );
    assert.equal(
      (await writeFieldsAndAppendHistory({ ...base, contactId: "c1", action: "" })).success,
      false,
    );
    assert.equal(
      (await writeFieldsAndAppendHistory({
        ...base, contactId: "c1", fieldWrites: [],
      })).success,
      false,
    );
    assert.equal(
      (await writeFieldsAndAppendHistory({
        ...base, contactId: "c1", affectedFields: [],
      })).success,
      false,
    );
  });

  it("spills to R2 when combined history would exceed HISTORY_CAP", async () => {
    const existing = Array.from({ length: HISTORY_CAP }, (_, i) => ({
      at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      actor: ACTOR_CONSOLE_SESSION,
      action: "old",
      affected_field: "f",
      snapshot_hash: `sha256:${String(i).padStart(16, "0")}`,
    }));
    const r2 = makeR2Stub();
    let putBody = null;
    const cap = stubFetch((url, init) => {
      if (String(url).includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      return emptyCatalogRes();
    });
    try {
      const res = await writeFieldsAndAppendHistory({
        contactId: "contact_xyz",
        fieldWrites: [{ key: "swot_bga_prep_brief", value: "BRIEF" }],
        action: "generate_prep_brief",
        affectedFields: ["swot_bga_prep_brief"],
        historyRaw: JSON.stringify(existing),
        env: makeEnv({ BGA_AUDIT: r2.binding }),
      });
      assert.equal(res.success, true);
      // One new entry pushed existing over the cap by 1, so exactly 1 spills.
      assert.equal(res.spilled_count, 1);
      // Trimmed field holds exactly HISTORY_CAP entries, newest at the end.
      const stored = JSON.parse(
        putBody.customFields.find((f) => f.key === HISTORY_FIELD_KEY).field_value,
      );
      assert.equal(stored.length, HISTORY_CAP);
      assert.equal(stored[stored.length - 1].action, "generate_prep_brief");
      // R2 holds the spilled entry under the right month/key.
      const spilledKey = `${SPILLOVER_PREFIX}/contact_xyz/2026-09.json`;
      assert.ok(r2.store.has(spilledKey));
      const spilledEntries = JSON.parse(r2.store.get(spilledKey));
      assert.equal(spilledEntries.length, 1);
      assert.equal(spilledEntries[0].action, "old");
    } finally { cap.restore(); }
  });

  it("fails closed with 503 when spillover is required but BGA_AUDIT is missing", async () => {
    const existing = Array.from({ length: HISTORY_CAP }, () => ({
      at: "2026-09-01T00:00:00Z", action: "old",
    }));
    const cap = stubFetch(() => emptyCatalogRes());
    try {
      const res = await writeFieldsAndAppendHistory({
        contactId: "c1",
        fieldWrites: [{ key: "swot_bga_prep_brief", value: "BRIEF" }],
        action: "generate_prep_brief",
        affectedFields: ["swot_bga_prep_brief"],
        historyRaw: JSON.stringify(existing),
        env: makeEnv({}), // no BGA_AUDIT
      });
      assert.equal(res.success, false);
      assert.equal(res.status, 503);
      assert.match(res.error, /BGA_AUDIT R2 binding not configured/);
    } finally { cap.restore(); }
  });

  it("fetches history itself when historyRaw not supplied", async () => {
    let putBody = null;
    const cap = stubFetch((url, init) => {
      const u = String(url);
      if (u.includes("/customFields") && !u.includes("/contacts/")) {
        return emptyCatalogRes();
      }
      if (u.includes("/contacts/") && init?.method === "PUT") {
        putBody = JSON.parse(init.body);
        return new Response("", { status: 200 });
      }
      // GET contact — return it with no prior history.
      return ghlContactRes({ customFields: [] });
    });
    try {
      const res = await writeFieldsAndAppendHistory({
        contactId: "c1",
        fieldWrites: [{ key: "swot_bga_prep_brief", value: "BRIEF" }],
        action: "generate_prep_brief",
        affectedFields: ["swot_bga_prep_brief"],
        env: makeEnv(),
      });
      assert.equal(res.success, true);
      const stored = JSON.parse(
        putBody.customFields.find((f) => f.key === HISTORY_FIELD_KEY).field_value,
      );
      assert.equal(stored.length, 1);
    } finally { cap.restore(); }
  });
});

describe("§9 guardrail 15 — version history grows across tool calls", () => {
  // Three different tools in sequence; the field grows by one entry per
  // affected field, and the ordering reflects the sequence.
  it("three different tools append one entry each (order preserved)", async () => {
    let historyRaw = "";
    const writes = [
      {
        action: "verified_financials_panel",
        fieldWrites: [{ key: "swot_verified_financials", value: "[]" }],
        affectedFields: ["swot_verified_financials"],
      },
      {
        action: "generate_roadmap_draft",
        fieldWrites: [
          { key: "swot_growth_plan_draft", value: "DRAFT" },
          { key: "swot_bga_services_catalog_ref", value: "abc123def456" },
        ],
        affectedFields: ["swot_growth_plan_draft", "swot_bga_services_catalog_ref"],
        catalogRef: "abc123def456",
      },
      {
        action: "generate_prep_brief",
        fieldWrites: [{ key: "swot_bga_prep_brief", value: "BRIEF" }],
        affectedFields: ["swot_bga_prep_brief"],
      },
    ];
    for (const w of writes) {
      let putBody = null;
      const cap = stubFetch((url, init) => {
        if (String(url).includes("/contacts/") && init?.method === "PUT") {
          putBody = JSON.parse(init.body);
          return new Response("", { status: 200 });
        }
        return emptyCatalogRes();
      });
      try {
        const res = await writeFieldsAndAppendHistory({
          contactId: "c1",
          historyRaw,
          env: makeEnv(),
          ...w,
        });
        assert.equal(res.success, true);
        historyRaw = putBody.customFields.find((f) => f.key === HISTORY_FIELD_KEY).field_value;
      } finally { cap.restore(); }
    }
    const final = JSON.parse(historyRaw);
    // 1 (VF) + 2 (draft + catalog_ref) + 1 (prep brief) = 4 entries.
    assert.equal(final.length, 4);
    assert.equal(final[0].action, "verified_financials_panel");
    assert.equal(final[1].action, "generate_roadmap_draft");
    assert.equal(final[2].action, "generate_roadmap_draft");
    assert.equal(final[3].action, "generate_prep_brief");
  });
});
