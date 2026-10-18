// BGA Copilot — Service Catalog + Bundles admin page (slice B of 5;
// customer directive 2026-10-17).
//
// Served at GET /asksolomon/catalog. Password-gated via the same
// sessionStorage key the console + case view use (asksolomon_password);
// the API endpoints behind this page are also x-console-password-gated
// in catalog_admin.js, so a direct curl without the header is refused.
//
// What the page does:
//   - Loads the currently-active version's services + bundles.
//   - Lets the admin edit any field inline (text, long-text, newline-
//     separated arrays, raw JSON for pricing/bundle_eligibility).
//   - "Add service" / "Add bundle" buttons for net-new entries.
//   - "Remove" checkbox on each entry — a removed entry is simply
//     omitted from the publish payload (full-snapshot semantics).
//   - "Note" + "Published by" fields the admin fills in before
//     clicking Publish.
//   - Publish → POST /asksolomon/catalog/publish; on success refreshes
//     the active-version view against the new version id.
//   - Version-history panel at the bottom (last 200 versions).
//
// Scope boundaries (deliberately NOT in slice B):
//   - No per-case strategist overrides — those land in slice C.
//   - No pending-rule-suggestion learning loop — slice D.
//   - No role-based access control beyond the shared console
//     password. The whole admin surface rides the same gate as the
//     strategist console; a dedicated staff role lands later.
//
// Keep the visual language in line with case_view_page.js / console_page.js
// — same font stack, same panel + button styling — so operators moving
// between pages don't feel a seam.

export const CATALOG_ADMIN_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Service Catalog · Ask Solomon — CFO By Design</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    background: #fafafa; color: #1a1a1a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    font-size: 14px; line-height: 1.5;
  }
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 24px; background: #ffffff; border-bottom: 1px solid #e5e7eb;
  }
  .brand { font-weight: 700; font-size: 16px; color: #1a1a1a; }
  .brand span { color: #92400e; }
  .subbrand { font-size: 11px; color: #6b7280; letter-spacing: 1.5px; text-transform: uppercase; margin-left: 12px; }
  .app-nav { display: flex; gap: 4px; margin-left: 24px; margin-right: auto; }
  .app-nav a, .app-nav span.active {
    display: inline-block;
    padding: 6px 14px; border-radius: 6px; font-size: 13px; font-weight: 500;
    color: #6b7280; text-decoration: none; border: 1px solid transparent;
  }
  .app-nav a:hover { background: #f3f4f6; color: #1a1a1a; }
  .app-nav span.active {
    background: #fef3c7; color: #92400e; border-color: #fde68a;
    cursor: default;
  }
  button, .btn {
    padding: 8px 14px; border-radius: 6px; border: 1px solid #d1d5db;
    background: #ffffff; color: #1a1a1a; font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: inherit;
  }
  button:hover, .btn:hover { background: #f3f4f6; }
  button.primary { background: #1a1a1a; color: #ffffff; border-color: #1a1a1a; }
  button.primary:hover { background: #374151; }
  button.danger { color: #991b1b; border-color: #fecaca; }
  button.danger:hover { background: #fee2e2; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .panel {
    background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;
    margin-bottom: 16px;
  }
  .panel h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7280;
    margin: 0 0 12px; font-weight: 600;
  }
  label { display: block; font-size: 12px; color: #374151; margin-bottom: 4px; font-weight: 500; }
  input[type="text"], input[type="password"], textarea {
    width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px;
    font-size: 13px; font-family: inherit; color: #1a1a1a; background: #ffffff;
  }
  textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; }
  textarea.narrow { min-height: 60px; }
  textarea.tall   { min-height: 100px; }
  .hidden { display: none !important; }
  .loader { color: #6b7280; font-size: 13px; }
  .error-banner {
    background: #fee2e2; border: 1px solid #fecaca; color: #991b1b;
    padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 12px;
  }
  .success-banner {
    background: #d1fae5; border: 1px solid #a7f3d0; color: #065f46;
    padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 12px;
  }
  .warn-banner {
    background: #fef3c7; border: 1px solid #fde68a; color: #92400e;
    padding: 10px 14px; border-radius: 6px; font-size: 12px; line-height: 1.5; margin-bottom: 12px;
  }
  .version-pill {
    display: inline-block; padding: 2px 10px; border-radius: 10px; font-size: 12px;
    background: #fef3c7; color: #92400e; font-weight: 600;
  }
  .meta-row {
    display: flex; flex-wrap: wrap; gap: 18px; font-size: 12px; color: #4b5563;
    margin-bottom: 8px;
  }
  .meta-row b { color: #1a1a1a; }
  .entry-card {
    border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 10px;
    background: #ffffff; padding: 0;
  }
  .entry-card.removed { opacity: 0.5; }
  .entry-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px; border-bottom: 1px solid #f3f4f6; background: #fafafa;
    cursor: pointer; user-select: none;
  }
  .entry-head .title { font-weight: 600; font-size: 14px; color: #1a1a1a; }
  .entry-head .id { font-family: ui-monospace, monospace; font-size: 11px; color: #6b7280; margin-left: 8px; }
  .entry-head .caret { color: #9ca3af; font-size: 12px; }
  .entry-head .caret::before { content: "▸"; }
  .entry-card.open .entry-head .caret::before { content: "▾"; }
  .entry-body { padding: 14px; display: none; }
  .entry-card.open .entry-body { display: block; }
  .field-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px;
  }
  .field-grid > .full { grid-column: 1 / -1; }
  .remove-row {
    margin-top: 10px; padding-top: 10px; border-top: 1px dashed #e5e7eb;
    display: flex; align-items: center; gap: 10px;
  }
  .remove-row label { margin: 0; cursor: pointer; }
  .remove-row input[type="checkbox"] { margin-right: 4px; }
  .footer-actions {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb;
  }
  .publish-form { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; }
  table.versions { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.versions th, table.versions td {
    text-align: left; padding: 8px 10px; border-bottom: 1px solid #f3f4f6; vertical-align: top;
  }
  table.versions th { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; }
  table.versions .active-row { background: #fef3c7; }
  table.versions code { font-family: ui-monospace, monospace; font-size: 11px; color: #4b5563; }
  .hint { font-size: 11px; color: #6b7280; margin-top: 4px; }
  .footer-note {
    font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px;
  }
</style>
</head>
<body>
  <div class="topbar">
    <div style="display:flex;align-items:center;">
      <div class="brand">Ask <span>Solomon</span></div>
      <div class="subbrand">BGA Copilot</div>
      <nav class="app-nav">
        <a href="/asksolomon">Console</a>
        <a href="/asksolomon/case">Case View</a>
        <span class="active">Catalog</span>
      </nav>
    </div>
    <div><button id="btn-logout" title="Clear password">Sign out</button></div>
  </div>

  <div class="wrap">
    <div id="gate" class="panel">
      <h2>Password required</h2>
      <p style="margin:0 0 12px 0;color:#6b7280;font-size:13px;">
        This is a staff-only admin page. The password is the same one the console and case view use.
      </p>
      <div style="display:flex;gap:10px;align-items:flex-end;">
        <div style="flex:1;">
          <label for="pw">Password</label>
          <input id="pw" type="password" autocomplete="current-password">
        </div>
        <button id="btn-unlock" class="primary">Unlock</button>
      </div>
      <div id="gate-err" class="hidden"></div>
    </div>

    <div id="app" class="hidden">
      <div class="panel">
        <h2>Active catalog</h2>
        <div id="status-line" class="meta-row">
          <span class="loader">Loading…</span>
        </div>
        <div class="warn-banner">
          Publish creates a <b>new immutable version</b> and promotes it to active.
          Previous versions are preserved so stored cases keep resolving to the catalog they were built against.
          Full-snapshot semantics: whatever is in the editor at publish time IS the new version — a removed row is one you leave out of the next publish.
        </div>
      </div>

      <div id="banner-slot"></div>

      <div class="panel">
        <h2>Services</h2>
        <div id="services-list"><span class="loader">Loading…</span></div>
        <div style="margin-top:12px;">
          <button id="btn-add-service">+ Add service</button>
        </div>
      </div>

      <div class="panel">
        <h2>Bundles</h2>
        <div id="bundles-list"><span class="loader">Loading…</span></div>
        <div style="margin-top:12px;">
          <button id="btn-add-bundle">+ Add bundle</button>
        </div>
      </div>

      <div class="panel">
        <h2>Publish</h2>
        <div class="publish-form">
          <div>
            <label for="pub-by">Published by</label>
            <input id="pub-by" type="text" placeholder="your email or handle">
          </div>
          <div>
            <label for="pub-note">Note (why this change)</label>
            <input id="pub-note" type="text" placeholder="e.g., add caution rule for new-business signal on VF service">
          </div>
          <div>
            <button id="btn-publish" class="primary">Publish new version</button>
          </div>
        </div>
        <div class="hint">
          On successful publish, the new version is activated immediately; the matcher cache is invalidated on this isolate so other request flows pick it up on their next call.
        </div>
      </div>

      <div class="panel">
        <h2>Version history</h2>
        <div id="versions-list"><span class="loader">Loading…</span></div>
      </div>

      <div class="footer-note">
        Service Catalog admin · slice B of 5 (strategist overrides, learning loop, and audit land in slices C-E).
      </div>
    </div>
  </div>

<script>
(() => {
  const $ = (sel) => document.querySelector(sel);
  const PW_KEY = "asksolomon_password";
  const state = {
    services: [],
    bundles:  [],
    activeVersionId: null,
    activeMeta: null,
  };

  function pw() { return sessionStorage.getItem(PW_KEY) || ""; }
  function savePw(v) { sessionStorage.setItem(PW_KEY, v); }
  function clearPw() { sessionStorage.removeItem(PW_KEY); }

  async function api(path, body) {
    const resp = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-console-password": pw(),
      },
      body: JSON.stringify(body || {}),
    });
    const text = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}
    if (!resp.ok) {
      const err = (parsed && parsed.error) || resp.statusText || "request failed";
      const e = new Error(err);
      e.status = resp.status;
      throw e;
    }
    return parsed || {};
  }

  function showBanner(kind, msg) {
    const slot = $("#banner-slot");
    slot.innerHTML = "<div class=\\"" + (kind === "error" ? "error-banner" : "success-banner") + "\\">" +
      escapeHtml(msg) + "</div>";
    if (kind === "success") setTimeout(() => { slot.innerHTML = ""; }, 6000);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function linesToArr(s) {
    return String(s || "")
      .split(/\\r?\\n/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function arrToLines(a) {
    return (Array.isArray(a) ? a : []).join("\\n");
  }

  function jsonTextOf(v) {
    try { return JSON.stringify(v || {}, null, 2); } catch { return "{}"; }
  }

  function parseJsonInput(txt, fallback) {
    const t = String(txt || "").trim();
    if (!t) return fallback;
    try { return JSON.parse(t); } catch (e) { throw new Error("invalid JSON: " + e.message); }
  }

  function renderServiceCard(svc, idx) {
    const safeId = "svc-" + idx;
    return \`
      <div class="entry-card" id="\${safeId}" data-idx="\${idx}">
        <div class="entry-head" onclick="window.__toggleCard('\${safeId}')">
          <div>
            <span class="title">\${escapeHtml(svc.name || "(unnamed service)")}</span>
            <span class="id">\${escapeHtml(svc.service_id || "no_id")}</span>
          </div>
          <span class="caret"></span>
        </div>
        <div class="entry-body">
          <div class="field-grid">
            <div><label>service_id</label><input type="text" data-k="service_id" value="\${escapeHtml(svc.service_id || "")}"></div>
            <div><label>name</label><input type="text" data-k="name" value="\${escapeHtml(svc.name || "")}"></div>
            <div class="full"><label>problem_solved</label><textarea class="narrow" data-k="problem_solved">\${escapeHtml(svc.problem_solved || "")}</textarea></div>
            <div><label>signals_relevant (one per line)</label><textarea class="narrow" data-k="signals_relevant">\${escapeHtml(arrToLines(svc.signals_relevant))}</textarea></div>
            <div><label>hard_block_rules (one per line)</label><textarea class="narrow" data-k="hard_block_rules">\${escapeHtml(arrToLines(svc.hard_block_rules))}</textarea></div>
            <div><label>caution_rules (one per line)</label><textarea class="narrow" data-k="caution_rules">\${escapeHtml(arrToLines(svc.caution_rules))}</textarea></div>
            <div><label>defer_rules (one per line)</label><textarea class="narrow" data-k="defer_rules">\${escapeHtml(arrToLines(svc.defer_rules))}</textarea></div>
            <div><label>deliverables (one per line)</label><textarea class="narrow" data-k="deliverables">\${escapeHtml(arrToLines(svc.deliverables))}</textarea></div>
            <div><label>dependencies (one per line)</label><textarea class="narrow" data-k="dependencies">\${escapeHtml(arrToLines(svc.dependencies))}</textarea></div>
            <div><label>client_responsibility (one per line)</label><textarea class="narrow" data-k="client_responsibility">\${escapeHtml(arrToLines(svc.client_responsibility))}</textarea></div>
            <div><label>cfobd_responsibility (one per line)</label><textarea class="narrow" data-k="cfobd_responsibility">\${escapeHtml(arrToLines(svc.cfobd_responsibility))}</textarea></div>
            <div><label>talking_points — INTERNAL (one per line)</label><textarea class="narrow" data-k="talking_points">\${escapeHtml(arrToLines(svc.talking_points))}</textarea></div>
            <div><label>customer_value_points — CUSTOMER-FACING (one per line)</label><textarea class="narrow" data-k="customer_value_points">\${escapeHtml(arrToLines(svc.customer_value_points))}</textarea></div>
            <div><label>pricing (JSON)</label><textarea class="narrow" data-k="pricing">\${escapeHtml(jsonTextOf(svc.pricing))}</textarea></div>
            <div><label>bundle_eligibility (JSON)</label><textarea class="narrow" data-k="bundle_eligibility">\${escapeHtml(jsonTextOf(svc.bundle_eligibility))}</textarea></div>
          </div>
          <div class="remove-row">
            <label><input type="checkbox" data-k="__removed"> Omit this service from the next publish</label>
            <span class="hint">(the row stays in the previous version — it's only dropped going forward.)</span>
          </div>
        </div>
      </div>
    \`;
  }

  function renderBundleCard(b, idx) {
    const safeId = "bnd-" + idx;
    return \`
      <div class="entry-card" id="\${safeId}" data-idx="\${idx}">
        <div class="entry-head" onclick="window.__toggleCard('\${safeId}')">
          <div>
            <span class="title">\${escapeHtml(b.name || "(unnamed bundle)")}</span>
            <span class="id">\${escapeHtml(b.bundle_id || "no_id")}</span>
          </div>
          <span class="caret"></span>
        </div>
        <div class="entry-body">
          <div class="field-grid">
            <div><label>bundle_id</label><input type="text" data-k="bundle_id" value="\${escapeHtml(b.bundle_id || "")}"></div>
            <div><label>name</label><input type="text" data-k="name" value="\${escapeHtml(b.name || "")}"></div>
            <div class="full"><label>description</label><textarea class="narrow" data-k="description">\${escapeHtml(b.description || "")}</textarea></div>
            <div class="full"><label>included_service_ids (one per line)</label><textarea class="narrow" data-k="included_service_ids">\${escapeHtml(arrToLines(b.included_service_ids))}</textarea></div>
            <div class="full"><label>pricing (JSON)</label><textarea class="narrow" data-k="pricing">\${escapeHtml(jsonTextOf(b.pricing))}</textarea></div>
          </div>
          <div class="remove-row">
            <label><input type="checkbox" data-k="__removed"> Omit this bundle from the next publish</label>
          </div>
        </div>
      </div>
    \`;
  }

  window.__toggleCard = function (id) {
    document.getElementById(id).classList.toggle("open");
  };

  function renderServices() {
    const el = $("#services-list");
    if (!state.services.length) {
      el.innerHTML = "<p style='color:#6b7280;font-size:13px;'>No services yet. Click <b>Add service</b> to start.</p>";
      return;
    }
    el.innerHTML = state.services.map(renderServiceCard).join("");
  }

  function renderBundles() {
    const el = $("#bundles-list");
    if (!state.bundles.length) {
      el.innerHTML = "<p style='color:#6b7280;font-size:13px;'>No bundles yet.</p>";
      return;
    }
    el.innerHTML = state.bundles.map(renderBundleCard).join("");
  }

  function renderStatusLine() {
    const line = $("#status-line");
    if (!state.activeMeta) {
      line.innerHTML = "<span class='loader'>No active version yet — the first publish will create version 1.</span>";
      return;
    }
    const m = state.activeMeta;
    line.innerHTML = [
      "<div><span class='version-pill'>v" + m.versionId + "</span></div>",
      "<div><b>Published</b> " + escapeHtml(m.published_at || "–") + " by " + escapeHtml(m.published_by || "–") + "</div>",
      m.note ? "<div><b>Note</b> " + escapeHtml(m.note) + "</div>" : "",
      "<div><b>services_sha</b> <code>" + escapeHtml(m.services_sha || "–") + "</code></div>",
      "<div><b>bundles_sha</b> <code>" + escapeHtml(m.bundles_sha || "–") + "</code></div>",
    ].filter(Boolean).join("");
  }

  function renderVersions(list, activeId) {
    const el = $("#versions-list");
    if (!list || !list.length) {
      el.innerHTML = "<p style='color:#6b7280;font-size:13px;'>No versions yet.</p>";
      return;
    }
    el.innerHTML =
      "<table class='versions'><thead><tr>" +
      "<th>v</th><th>Published</th><th>By</th><th>Note</th><th>services_sha</th><th>bundles_sha</th><th></th>" +
      "</tr></thead><tbody>" +
      list.map((v) => {
        const active = Number(v.id) === Number(activeId);
        return "<tr class='" + (active ? "active-row" : "") + "'>" +
          "<td>" + v.id + (active ? " <span style='color:#92400e;font-weight:700;'>active</span>" : "") + "</td>" +
          "<td>" + escapeHtml(v.published_at || "") + "</td>" +
          "<td>" + escapeHtml(v.published_by || "") + "</td>" +
          "<td>" + escapeHtml(v.note || "") + "</td>" +
          "<td><code>" + escapeHtml(v.services_sha || "") + "</code></td>" +
          "<td><code>" + escapeHtml(v.bundles_sha || "") + "</code></td>" +
          "<td><button data-load-v='" + v.id + "'>Load into editor</button></td>" +
          "</tr>";
      }).join("") +
      "</tbody></table>";
    el.querySelectorAll("button[data-load-v]").forEach((btn) => {
      btn.addEventListener("click", () => loadVersionIntoEditor(Number(btn.getAttribute("data-load-v"))));
    });
  }

  function readCardFields(cardEl) {
    const out = {};
    cardEl.querySelectorAll("[data-k]").forEach((inp) => {
      const k = inp.getAttribute("data-k");
      if (inp.type === "checkbox") out[k] = inp.checked;
      else out[k] = inp.value;
    });
    return out;
  }

  function harvestServices() {
    const cards = $("#services-list").querySelectorAll(".entry-card");
    const out = [];
    cards.forEach((card) => {
      const f = readCardFields(card);
      if (f.__removed) return;
      let pricing, bundleEligibility;
      try { pricing = parseJsonInput(f.pricing, {}); }
      catch (e) { throw new Error("service '" + (f.service_id || "?") + "' pricing: " + e.message); }
      try { bundleEligibility = parseJsonInput(f.bundle_eligibility, {}); }
      catch (e) { throw new Error("service '" + (f.service_id || "?") + "' bundle_eligibility: " + e.message); }
      out.push({
        service_id:            String(f.service_id || "").trim(),
        name:                  String(f.name || "").trim(),
        problem_solved:        String(f.problem_solved || "").trim(),
        signals_relevant:      linesToArr(f.signals_relevant),
        hard_block_rules:      linesToArr(f.hard_block_rules),
        caution_rules:         linesToArr(f.caution_rules),
        defer_rules:           linesToArr(f.defer_rules),
        deliverables:          linesToArr(f.deliverables),
        dependencies:          linesToArr(f.dependencies),
        client_responsibility: linesToArr(f.client_responsibility),
        cfobd_responsibility:  linesToArr(f.cfobd_responsibility),
        talking_points:        linesToArr(f.talking_points),
        customer_value_points: linesToArr(f.customer_value_points),
        pricing,
        bundle_eligibility:    bundleEligibility,
      });
    });
    return out;
  }

  function harvestBundles() {
    const cards = $("#bundles-list").querySelectorAll(".entry-card");
    const out = [];
    cards.forEach((card) => {
      const f = readCardFields(card);
      if (f.__removed) return;
      let pricing;
      try { pricing = parseJsonInput(f.pricing, {}); }
      catch (e) { throw new Error("bundle '" + (f.bundle_id || "?") + "' pricing: " + e.message); }
      out.push({
        bundle_id:            String(f.bundle_id || "").trim(),
        name:                 String(f.name || "").trim(),
        description:          String(f.description || "").trim(),
        included_service_ids: linesToArr(f.included_service_ids),
        pricing,
      });
    });
    return out;
  }

  async function loadActive() {
    try {
      const r = await api("/asksolomon/catalog/active", {});
      state.activeMeta       = r.active;
      state.activeVersionId  = r.active ? r.active.versionId : null;
      state.services         = (r.active && Array.isArray(r.active.services)) ? r.active.services : [];
      state.bundles          = (r.active && Array.isArray(r.active.bundles))  ? r.active.bundles  : [];
      renderStatusLine();
      renderServices();
      renderBundles();
    } catch (err) {
      if (err.status === 401) { showGate("Password rejected."); return; }
      showBanner("error", "Failed to load active version: " + err.message);
    }
  }

  async function loadVersions() {
    try {
      const r = await api("/asksolomon/catalog/versions", {});
      renderVersions(r.versions || [], r.activeVersionId);
    } catch (err) {
      if (err.status === 401) { showGate("Password rejected."); return; }
      $("#versions-list").innerHTML = "<p class='error-banner'>Failed to load versions: " + escapeHtml(err.message) + "</p>";
    }
  }

  async function loadVersionIntoEditor(versionId) {
    try {
      const r = await api("/asksolomon/catalog/version", { versionId });
      if (!r.active) {
        showBanner("error", "Version " + versionId + " not found.");
        return;
      }
      state.activeMeta       = r.active;
      state.services         = r.active.services || [];
      state.bundles          = r.active.bundles  || [];
      renderStatusLine();
      renderServices();
      renderBundles();
      showBanner("success", "Loaded version " + versionId + " into the editor. Publishing will create a new version from these edits.");
    } catch (err) {
      showBanner("error", err.message);
    }
  }

  async function publish() {
    const btn = $("#btn-publish");
    const by  = $("#pub-by").value.trim();
    const note = $("#pub-note").value.trim();
    if (!by)   { showBanner("error", "Enter who's publishing (email or handle)."); return; }
    if (!note) { showBanner("error", "Enter a note describing what changed."); return; }
    let services, bundles;
    try {
      services = harvestServices();
      bundles  = harvestBundles();
    } catch (err) {
      showBanner("error", err.message);
      return;
    }
    btn.disabled = true;
    try {
      const r = await api("/asksolomon/catalog/publish", { note, publishedBy: by, services, bundles });
      showBanner("success", "Published version " + r.versionId + " · " +
                 r.counts.services + " services · " + r.counts.bundles + " bundles.");
      $("#pub-note").value = "";
      await Promise.all([loadActive(), loadVersions()]);
    } catch (err) {
      showBanner("error", err.message);
    } finally {
      btn.disabled = false;
    }
  }

  function addService() {
    state.services.push({
      service_id: "", name: "", problem_solved: "",
      signals_relevant: [], hard_block_rules: [], caution_rules: [], defer_rules: [],
      deliverables: [], client_responsibility: [], cfobd_responsibility: [],
      pricing: {}, bundle_eligibility: {}, dependencies: [],
      talking_points: [], customer_value_points: [],
    });
    renderServices();
    const last = $("#services-list").lastElementChild;
    if (last) last.classList.add("open");
  }

  function addBundle() {
    state.bundles.push({ bundle_id: "", name: "", description: "", included_service_ids: [], pricing: {} });
    renderBundles();
    const last = $("#bundles-list").lastElementChild;
    if (last) last.classList.add("open");
  }

  function showGate(err) {
    $("#gate").classList.remove("hidden");
    $("#app").classList.add("hidden");
    if (err) {
      const el = $("#gate-err");
      el.className = "error-banner";
      el.textContent = err;
    }
  }

  function hideGate() {
    $("#gate").classList.add("hidden");
    $("#app").classList.remove("hidden");
  }

  async function onUnlock() {
    const v = $("#pw").value.trim();
    if (!v) { showGate("Password required."); return; }
    savePw(v);
    hideGate();
    await Promise.all([loadActive(), loadVersions()]);
  }

  function onLogout() {
    clearPw();
    showGate();
  }

  // Wiring
  $("#btn-unlock").addEventListener("click", onUnlock);
  $("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") onUnlock(); });
  $("#btn-logout").addEventListener("click", onLogout);
  $("#btn-add-service").addEventListener("click", addService);
  $("#btn-add-bundle").addEventListener("click", addBundle);
  $("#btn-publish").addEventListener("click", publish);

  // If a password is already in sessionStorage from another tab, skip the gate.
  if (pw()) {
    hideGate();
    Promise.all([loadActive(), loadVersions()]);
  }
})();
</script>
</body>
</html>`;
