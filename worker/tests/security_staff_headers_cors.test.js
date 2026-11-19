// Staff-route security headers + narrowed CORS (security review 2026-11-19).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import worker, { isStaffPath } from "../src/index.js";

const env = { CONSOLE_PASSWORD: "pw" };

function get(path, headers = {}) {
  return new Request(`https://swot-engine.test${path}`, { headers });
}

describe("isStaffPath", () => {
  it("classifies staff vs public routes", () => {
    for (const p of ["/asksolomon", "/asksolomon/", "/asksolomon/case", "/asksolomon/run",
      "/strategist", "/strategist/report/x", "/feedback", "/feedback/pending-summary", "/diag/webhook-secret"]) {
      assert.equal(isStaffPath(p), true, p);
    }
    for (const p of ["/", "/report/abc", "/verify", "/upload", "/audit", "/marketing/render",
      "/apply-solomon50", "/from-ghl-survey", "/verify-bga-access", "/asksolomonx"]) {
      assert.equal(isStaffPath(p), false, p);
    }
  });
});

describe("staff pages", () => {
  it("/asksolomon HTML gets frame-ancestors, no-referrer, no wildcard CORS", async () => {
    const res = await worker.fetch(get("/asksolomon", { Origin: "https://evil.example" }), env, {});
    assert.equal(res.status, 200);
    const csp = res.headers.get("Content-Security-Policy") || "";
    assert.match(csp, /^frame-ancestors /);
    assert.ok(csp.includes("'self'"));
    assert.ok(csp.includes("https://my.cfobydesign.com"));
    assert.ok(csp.includes("https://*.gohighlevel.com"));
    assert.ok(csp.includes("https://*.leadconnectorhq.com"));
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.match(await res.text(), /<html/i);
  });

  it("staff API 401s carry the headers too and no wildcard", async () => {
    const res = await worker.fetch(get("/asksolomon/rubric", { Origin: "https://evil.example" }), env, {});
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  });

  it("preflight from an unlisted origin gets no CORS grant", async () => {
    const req = new Request("https://swot-engine.test/asksolomon/run", {
      method: "OPTIONS", headers: { Origin: "https://evil.example" },
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("reflects an origin listed in STAFF_CORS_ORIGINS", async () => {
    const e = { ...env, STAFF_CORS_ORIGINS: "https://portal.example, https://other.example" };
    const req = new Request("https://swot-engine.test/asksolomon/run", {
      method: "OPTIONS", headers: { Origin: "https://portal.example" },
    });
    const res = await worker.fetch(req, e, {});
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://portal.example");
    assert.match(res.headers.get("Access-Control-Allow-Headers") || "", /x-console-password/);
  });

  it("STAFF_FRAME_ANCESTORS adds ancestors", async () => {
    const res = await worker.fetch(get("/asksolomon/case"), { ...env, STAFF_FRAME_ANCESTORS: "https://portal.example" }, {});
    assert.ok((res.headers.get("Content-Security-Policy") || "").includes("https://portal.example"));
  });
});

describe("public routes keep wildcard CORS (funnel at oppeak26.pages.dev)", () => {
  it("POST / preflight still allows *", async () => {
    const req = new Request("https://swot-engine.test/", {
      method: "OPTIONS", headers: { Origin: "https://oppeak26.pages.dev" },
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(res.headers.get("Content-Security-Policy"), null);
  });

  it("/verify error responses still allow *", async () => {
    const req = new Request("https://swot-engine.test/verify", {
      method: "POST", headers: { "content-type": "application/json", Origin: "https://oppeak26.pages.dev" }, body: "{}",
    });
    const res = await worker.fetch(req, env, {});
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  });
});
