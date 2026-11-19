// POST /upload auth (security review 2026-11-19).
//
// /upload used to forward any multipart file (up to 25 MB) into the GHL
// media library with no auth. It now requires either the staff console
// password or a contactId whose GHL contact carries a paid/beta tag.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";
import { captureFetch } from "./helpers.js";

const env = {
  GHL_API_KEY: "test-ghl-key",
  GHL_LOCATION_ID: "test-loc",
  CONSOLE_PASSWORD: "staff-pw",
};

function uploadRequest({ contactId, password } = {}) {
  const fd = new FormData();
  fd.append("file", new File(["hello"], "pnl.pdf", { type: "application/pdf" }));
  if (contactId) fd.append("contactId", contactId);
  const headers = {};
  if (password) headers["x-console-password"] = password;
  return new Request("https://example.com/upload", { method: "POST", headers, body: fd });
}

function ghlResponder(tags) {
  return (url) => {
    const u = String(url);
    if (u.includes("/medias/upload-file")) {
      return new Response(JSON.stringify({ fileId: "f1", url: "https://cdn.test/f1" }), { status: 200 });
    }
    if (u.includes("/contacts/")) {
      if (tags === null) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ contact: { id: "c1", tags } }), { status: 200 });
    }
    return new Response("{}", { status: 500 });
  };
}

describe("POST /upload auth", () => {
  it("refuses an anonymous upload and never calls the GHL media API", async () => {
    const f = captureFetch(ghlResponder([]));
    try {
      const res = await worker.fetch(uploadRequest(), env, {});
      assert.equal(res.status, 401);
      assert.ok(!f.calls.some(c => c.url.includes("/medias/upload-file")));
    } finally { f.restore(); }
  });

  it("refuses a contactId with no paid tag", async () => {
    const f = captureFetch(ghlResponder(["lead"]));
    try {
      const res = await worker.fetch(uploadRequest({ contactId: "c1" }), env, {});
      assert.equal(res.status, 401);
      assert.ok(!f.calls.some(c => c.url.includes("/medias/upload-file")));
    } finally { f.restore(); }
  });

  it("refuses an unknown contactId", async () => {
    const f = captureFetch(ghlResponder(null));
    try {
      const res = await worker.fetch(uploadRequest({ contactId: "nope" }), env, {});
      assert.equal(res.status, 401);
    } finally { f.restore(); }
  });

  it("refuses a wrong console password", async () => {
    const f = captureFetch(ghlResponder([]));
    try {
      const res = await worker.fetch(uploadRequest({ password: "wrong" }), env, {});
      assert.equal(res.status, 401);
    } finally { f.restore(); }
  });

  it("accepts a contact tagged swot_paid_47 (Deep Dive is sell-first)", async () => {
    const f = captureFetch(ghlResponder(["swot_paid_47"]));
    try {
      const res = await worker.fetch(uploadRequest({ contactId: "c1" }), env, {});
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.url, "https://cdn.test/f1");
    } finally { f.restore(); }
  });

  it("accepts staff with the console password and no contactId", async () => {
    const f = captureFetch(ghlResponder([]));
    try {
      const res = await worker.fetch(uploadRequest({ password: "staff-pw" }), env, {});
      assert.equal(res.status, 200);
    } finally { f.restore(); }
  });
});
