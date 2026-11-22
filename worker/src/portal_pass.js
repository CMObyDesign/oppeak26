// Staff pass from the CFO Portal (cfo-portal Worker).
//
// The portal's server calls Solomon's console endpoints on behalf of a signed-in staff member. Each
// request carries `x-portal-pass`: a short-lived note signed with PORTAL_PASS_KEY (a secret shared by
// both Workers) that names the staff member, their role, the contact it is about, the exact endpoint
// and method, and expires within two minutes.
//
// The gate runs before routing. A request with a pass is either:
//   - verified and on the allowlist → it counts as console-authorized for that one request, or
//   - refused right here (bad signature, expired, wrong endpoint, not on the allowlist, admin-only,
//     or /asksolomon/run with a contactId).
// So a pass can never reach the SWOT funnel, payments, tags, send-result, approve-and-send, or any
// route that writes to a client. Spec: client-portal-rebuild/specs/SOLOMON_IN_PORTAL.md.

export const PASS_HEADER = "x-portal-pass";
const MAX_LIFETIME_SEC = 120;

// Exact paths. Every one was checked: it doesn't send, tag, or write to HighLevel.
const EXACT = new Set([
  // BGA workspace (Solomon's own case records only)
  "/asksolomon/case/search",
  "/asksolomon/case/load",
  "/asksolomon/case/audit-gaps",
  "/asksolomon/case/verified-financials",
  "/asksolomon/case/extract-financials-from-document",
  "/asksolomon/case/generate-roadmap-draft",
  "/asksolomon/case/update-roadmap-section",
  "/asksolomon/case/challenge-roadmap",
  "/asksolomon/case/red-team-check",
  "/asksolomon/case/match-services",
  "/asksolomon/case/generate-prep-brief",
  "/asksolomon/case/extract-call-decisions",
  "/asksolomon/case/confirm-call-decisions",
  "/asksolomon/case/acknowledge-warning",
  "/asksolomon/case/override",
  "/asksolomon/case/override/revoke",
  "/asksolomon/case/overrides",
  // Service catalog (reads; the two writes below are admin-only)
  "/asksolomon/catalog/active",
  "/asksolomon/catalog/versions",
  "/asksolomon/catalog/version",
  "/asksolomon/catalog/suggestions",
  "/asksolomon/catalog/audit",
  "/asksolomon/catalog/suggestion/decide",
  "/asksolomon/catalog/publish",
  // Ask Solomon panel (answers only; /run with a contactId is refused below)
  "/asksolomon/run",
  "/asksolomon/history",
  "/asksolomon/library",
  "/asksolomon/bookmarks",
  "/asksolomon/rubrics",
]);

// Prefixes for item reads, GET only.
const GET_PREFIXES = ["/asksolomon/history/", "/asksolomon/library/", "/asksolomon/bookmarks/", "/asksolomon/rubrics/", "/strategist/report/"];
const GET_EXACT = new Set(["/strategist"]);

const ADMIN_ONLY = new Set(["/asksolomon/catalog/suggestion/decide", "/asksolomon/catalog/publish"]);

const ROLES = new Set(["advisor", "accounting", "support", "admin"]);

export function isAllowlisted(path, method) {
  if (EXACT.has(path)) return true;
  if (method === "GET" && (GET_EXACT.has(path) || GET_PREFIXES.some((p) => path.startsWith(p)))) return true;
  return false;
}

// Requests whose pass checked out. checkConsolePassword() consults this.
const verified = new WeakMap();

export function portalPassFor(request) {
  return verified.get(request) ?? null;
}

// Returns null when the request carries no pass (normal handling), or a Response to send instead
// (refusal). When the pass is good it records the request as verified and returns null.
export async function gatePortalPass(request, env) {
  const token = request.headers.get(PASS_HEADER);
  if (!token) return null;
  const refuse = (status, error) =>
    new Response(JSON.stringify({ success: false, error }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

  if (!env.PORTAL_PASS_KEY) return refuse(503, "Portal pass not configured");
  const pass = await verifyToken(token, env.PORTAL_PASS_KEY);
  if (!pass) return refuse(401, "Invalid portal pass");

  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  if (pass.aud !== "solomon" || pass.v !== 1) return refuse(401, "Invalid portal pass");
  if (typeof pass.exp !== "number" || typeof pass.iat !== "number" || pass.exp <= now || pass.exp - pass.iat > MAX_LIFETIME_SEC || pass.iat > now + 30) {
    return refuse(401, "Portal pass expired");
  }
  if (pass.ep !== url.pathname || pass.m !== request.method) return refuse(401, "Portal pass is for another endpoint");
  if (!ROLES.has(pass.role) || typeof pass.sid !== "number") return refuse(401, "Invalid portal pass");
  if (!isAllowlisted(url.pathname, request.method)) return refuse(403, "Not available to the portal");
  if (ADMIN_ONLY.has(url.pathname) && pass.role !== "admin") return refuse(403, "Admins only");

  // /asksolomon/run with a contactId overwrites the client's report fields. Never from the portal.
  if (url.pathname === "/asksolomon/run") {
    let body = null;
    try {
      body = await request.clone().json();
    } catch {
      body = null;
    }
    if (body && (body.contactId || body.contact_id)) return refuse(403, "The portal never runs Solomon against a contact");
  }

  verified.set(request, pass);
  console.log(JSON.stringify({ event: "portal_pass", sid: pass.sid, role: pass.role, ep: pass.ep, cid: pass.cid ?? null }));
  return null;
}

// token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload part, key))
async function verifyToken(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1] || token.length > 4096) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let sig;
  try {
    sig = fromB64url(parts[1]);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(parts[0]));
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
  } catch {
    return null;
  }
}

function fromB64url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// Used by tests (and mirrors the portal's signer).
export async function signPortalPass(payload, secret) {
  const enc = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = enc(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return `${body}.${enc(sig)}`;
}
