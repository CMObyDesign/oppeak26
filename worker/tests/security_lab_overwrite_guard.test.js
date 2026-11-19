// Lab overwrite guard (security review 2026-11-19).
//
// /asksolomon/run with a contactId and /asksolomon/send-result overwrite a
// real contact's customer-facing report field. Both now require
// confirmOverwrite:true plus confirmContactName matching the HL record.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker, { normalizePersonName } from "../src/index.js";
import { captureFetch } from "./helpers.js";

const PW = "staff-pw";
const AGENT = { path: "growth", opener: "hi", opportunityFlags: [] };

function makeEnv() {
  return {
    GHL_API_KEY: "test-ghl-key",
    GHL_LOCATION_ID: "test-loc",
    CONSOLE_PASSWORD: PW,
    __CLAUDE_STUB__: async () => JSON.stringify(AGENT),
  };
}

function makeCtx() {
  const tasks = [];
  return { tasks, waitUntil: (p) => tasks.push(p) };
}

function post(path, body) {
  return new Request(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-console-password": PW },
    body: JSON.stringify(body),
  });
}

function ghl(contact) {
  return (url, init) => {
    const u = String(url);
    if (u.endsWith("/contacts/c1") && (!init || !init.method || init.method === "GET")) {
      return contact
        ? new Response(JSON.stringify({ contact }), { status: 200 })
        : new Response("{}", { status: 404 });
    }
    return new Response("{}", { status: 200 });
  };
}

const writes = (calls) => calls.filter(c => c.init && c.init.method && c.init.method !== "GET");

const SEND_BODY = {
  tier: "paid_47",
  contact: { contactId: "c1" },
  agent: AGENT,
  reportHtml: "<p>report</p>",
};
const RUN_BODY = {
  tier: "free",
  contact: { contactId: "c1" },
  answers: [{ question: "q", answer: "a" }],
};
const CONTACT = { id: "c1", firstName: "Rosa", lastName: "Pérez", tags: [] };

for (const [route, base] of [["/asksolomon/send-result", SEND_BODY], ["/asksolomon/run", RUN_BODY]]) {
  describe(`${route} overwrite guard`, () => {
    it("refuses without confirmOverwrite and writes nothing", async () => {
      const f = captureFetch(ghl(CONTACT));
      const ctx = makeCtx();
      try {
        const res = await worker.fetch(post(route, base), makeEnv(), ctx);
        assert.equal(res.status, 409);
        assert.equal((await res.json()).code, "confirm_overwrite_required");
        await Promise.allSettled(ctx.tasks);
        assert.equal(writes(f.calls).length, 0);
      } finally { f.restore(); }
    });

    it("refuses when the typed name does not match HL", async () => {
      const f = captureFetch(ghl(CONTACT));
      const ctx = makeCtx();
      try {
        const body = { ...base, confirmOverwrite: true, confirmContactName: "Roseline Perez" };
        const res = await worker.fetch(post(route, body), makeEnv(), ctx);
        assert.equal(res.status, 409);
        assert.equal((await res.json()).code, "contact_name_mismatch");
        await Promise.allSettled(ctx.tasks);
        assert.equal(writes(f.calls).length, 0);
      } finally { f.restore(); }
    });

    it("refuses when the contact can't be loaded", async () => {
      const f = captureFetch(ghl(null));
      const ctx = makeCtx();
      try {
        const body = { ...base, confirmOverwrite: true, confirmContactName: "Rosa Pérez" };
        const res = await worker.fetch(post(route, body), makeEnv(), ctx);
        assert.equal(res.status, 409);
        await Promise.allSettled(ctx.tasks);
        assert.equal(writes(f.calls).length, 0);
      } finally { f.restore(); }
    });

    it("writes when confirmed with the matching name (case/space-insensitive)", async () => {
      const f = captureFetch(ghl(CONTACT));
      const ctx = makeCtx();
      try {
        const body = { ...base, confirmOverwrite: true, confirmContactName: "  rosa   PÉREZ " };
        const res = await worker.fetch(post(route, body), makeEnv(), ctx);
        assert.equal(res.status, 200);
        await Promise.allSettled(ctx.tasks);
        assert.ok(writes(f.calls).some(c => c.url.endsWith("/contacts/c1")));
      } finally { f.restore(); }
    });
  });
}

describe("/asksolomon/run without a contactId is unaffected", () => {
  it("synthetic run needs no confirmation", async () => {
    const f = captureFetch(ghl(CONTACT));
    try {
      const res = await worker.fetch(post("/asksolomon/run", { ...RUN_BODY, contact: {} }), makeEnv(), makeCtx());
      assert.equal(res.status, 200);
    } finally { f.restore(); }
  });
});

describe("normalizePersonName", () => {
  it("folds case and whitespace", () => {
    assert.equal(normalizePersonName("  Ana  María\tLópez "), "ana maría lópez");
  });
});
