// BGA Copilot — case view HTML page (PR 4 of the build, docs/BGA_COPILOT_SPEC.md §11 row 4).
//
// Read-only strategist view. Served at GET /asksolomon/case.
//
// What it does today:
//   - Password gate (shared with /asksolomon via sessionStorage key).
//   - Contact ID input.
//   - On "Load Case":
//       * POST /asksolomon/case/load → full bundle
//       * POST /asksolomon/case/audit-gaps → gap report
//     Both run in parallel; the view renders when both resolve.
//
// What it does NOT do yet:
//   - No roadmap draft, no services match, no decision log, no
//     call-notes capture. Those tools land in PR 5+.
//   - No write path from this page. The verified-financials-panel
//     endpoint is wired in the Worker (PR 3) but has no form here yet;
//     that lands in PR 5 so it ships alongside the roadmap draft and
//     has a place in the layout.
//
// Keep it functional and plain. Match the main console's visual
// language (same font stack, same panel/button styling) so operators
// moving between the two don't feel a seam.

export const CASE_VIEW_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BGA Case View — CFO By Design</title>
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
  .topbar-right { display: flex; gap: 12px; align-items: center; }
  button, .btn {
    padding: 8px 14px; border-radius: 6px; border: 1px solid #d1d5db;
    background: #ffffff; color: #1a1a1a; font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: inherit;
  }
  button:hover, .btn:hover { background: #f3f4f6; }
  button.primary { background: #1a1a1a; color: #ffffff; border-color: #1a1a1a; }
  button.primary:hover { background: #374151; }
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
  .form-row { display: flex; gap: 12px; align-items: flex-end; }
  .form-row > *:first-child { flex: 1; }
  label { display: block; font-size: 12px; color: #374151; margin-bottom: 4px; font-weight: 500; }
  input[type="text"], input[type="password"] {
    width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px;
    font-size: 13px; font-family: inherit; color: #1a1a1a; background: #ffffff;
  }
  .status-row { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 8px; }
  .status-item {
    display: flex; flex-direction: column; gap: 2px;
    font-size: 12px;
  }
  .status-item .k { color: #6b7280; text-transform: uppercase; letter-spacing: 1px; font-size: 10px; }
  .status-item .v { color: #1a1a1a; font-weight: 600; }
  .pill {
    display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px;
    font-weight: 600; letter-spacing: 0.5px;
  }
  .pill-growth { background: #d1fae5; color: #065f46; }
  .pill-needs { background: #fef3c7; color: #92400e; }
  .pill-rehab { background: #fee2e2; color: #991b1b; }
  .tag-row { display: flex; gap: 6px; flex-wrap: wrap; }
  .tag {
    display: inline-block; padding: 2px 8px; border-radius: 10px; background: #f3f4f6;
    color: #374151; font-size: 11px;
  }
  .tag.opp { background: #fef3c7; color: #92400e; }
  .section-content {
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px;
    padding: 12px; font-size: 13px; white-space: pre-wrap; max-height: 400px;
    overflow-y: auto; line-height: 1.6;
  }
  .section-content.empty { color: #9ca3af; font-style: italic; }
  .metric-grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
  }
  .metric-card {
    border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; background: #ffffff;
  }
  .metric-card .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
  .metric-card .value { font-size: 14px; font-weight: 600; margin-top: 4px; color: #1a1a1a; }
  .metric-card.missing { background: #fef3c7; border-color: #fcd34d; }
  .metric-card.missing .value { color: #92400e; font-weight: 500; font-style: italic; }
  .case-state-row {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }
  .case-state-item {
    border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .case-state-item .k { font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
  .case-state-item .v { font-size: 13px; font-weight: 600; color: #1a1a1a; }
  .case-state-item.yes .v { color: #065f46; }
  .case-state-item.no .v { color: #9ca3af; }
  .error-banner {
    background: #fee2e2; border: 1px solid #fecaca; color: #991b1b;
    padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 12px;
  }
  .hint { font-size: 12px; color: #6b7280; margin-top: 6px; }
  .hidden { display: none !important; }
  .loader { color: #6b7280; font-size: 13px; }
  .footer-note {
    font-size: 11px; color: #9ca3af; text-align: center; margin-top: 24px;
  }
  .scaffolding-note {
    background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af;
    padding: 10px 14px; border-radius: 6px; font-size: 12px; margin-bottom: 16px;
    line-height: 1.5;
  }
  .draft-banner {
    background: #fef3c7; border: 1px solid #fcd34d; color: #92400e;
    padding: 10px 14px; border-radius: 6px; font-size: 12px; font-weight: 700;
    letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px;
    text-align: center;
  }
  .section-block {
    border: 1px solid #e5e7eb; border-radius: 6px; margin-bottom: 10px;
    background: #ffffff;
  }
  .section-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px; border-bottom: 1px solid #f3f4f6; background: #fafafa;
  }
  .section-header .num {
    font-size: 10px; color: #92400e; font-weight: 700; letter-spacing: 1.5px;
    text-transform: uppercase;
  }
  .section-header .title {
    font-size: 14px; font-weight: 600; color: #1a1a1a; margin: 2px 0 0;
  }
  .section-actions button { font-size: 12px; padding: 4px 10px; }
  .section-body {
    padding: 12px 14px; font-size: 13px; white-space: pre-wrap;
    line-height: 1.6; color: #374151;
  }
  .section-body.editing { padding: 0; }
  .section-body textarea {
    width: 100%; padding: 12px 14px; border: 0; resize: vertical;
    font-family: inherit; font-size: 13px; line-height: 1.6;
    min-height: 160px;
  }
  .section-edit-actions {
    padding: 8px 14px; display: flex; gap: 8px; justify-content: flex-end;
    border-top: 1px solid #f3f4f6; background: #fafafa;
  }
  .generate-row {
    display: flex; justify-content: space-between; align-items: center;
    gap: 12px; font-size: 12px; color: #6b7280;
  }
</style>
</head>
<body>

<div class="topbar">
  <div>
    <span class="brand">BGA Case View<span>.</span></span>
    <span class="subbrand">Internal · Strategist only</span>
  </div>
  <div class="topbar-right">
    <a href="/asksolomon" class="btn">← Ask Solomon</a>
    <button onclick="logout()">Log out</button>
  </div>
</div>

<div class="wrap">

  <!-- Password gate -->
  <div id="gate" class="panel hidden">
    <h2>Console password</h2>
    <div class="form-row">
      <div>
        <label for="password-input">Password</label>
        <input id="password-input" type="password" autofocus>
      </div>
      <button class="primary" onclick="setPassword()">Unlock</button>
    </div>
    <div id="gate-error" class="hint"></div>
  </div>

  <!-- Load panel -->
  <div id="load-panel" class="panel hidden">
    <h2>Load a case</h2>
    <div class="form-row">
      <div>
        <label for="contact-id">GHL contact ID</label>
        <input id="contact-id" type="text" placeholder="e.g. a1B2c3D4e5F6g7H8i9J0" autocomplete="off">
      </div>
      <button id="load-button" class="primary" onclick="loadCase()">Load case</button>
    </div>
    <div class="hint">The contact must carry the <code>swot_paid_297</code> tag. The bundle and gap audit load in parallel; this view is read-only (PR 4 scaffolding — no writes from here yet).</div>
    <div id="load-error" class="error-banner hidden"></div>
  </div>

  <!-- Case content -->
  <div id="case-content" class="hidden">

    <div class="scaffolding-note">
      <strong>PR 4 scaffolding.</strong> This view assembles and
      displays the case bundle (spec §2.1) and runs the
      <code>audit_case_gaps</code> report on load. The roadmap draft,
      verified-financials form, service match and other toolkit
      actions land in later PRs.
    </div>

    <div class="panel">
      <h2>Case header</h2>
      <div id="case-header"></div>
    </div>

    <div class="panel">
      <h2>Audit — what's missing</h2>
      <div id="audit-pane"><div class="loader">Loading audit…</div></div>
    </div>

    <div class="panel">
      <h2>Verified financials</h2>
      <div id="verified-financials-pane"></div>

      <!-- Write form (PR 5a). Lets the strategist record one verified
           financial entry at a time. Each save pins the write to the
           hash the client last read; the server returns 409 if another
           save landed in between and the UI prompts for refresh. -->
      <div class="vf-form-wrap" id="vf-form-wrap" style="margin-top:16px; padding-top:16px; border-top:1px solid #e5e7eb;">
        <h3 style="font-size:12px; text-transform:uppercase; letter-spacing:1.2px; color:#374151; margin:0 0 10px; font-weight:600;">Record a verified financial</h3>
        <div class="form-row" style="align-items:flex-start;">
          <div>
            <label for="vf-metric">Metric</label>
            <select id="vf-metric" onchange="renderVfValueInput()"></select>
          </div>
          <div id="vf-value-wrap">
            <label for="vf-value">Value</label>
            <input id="vf-value" type="text" placeholder="(pick a metric)">
          </div>
        </div>
        <div class="form-row">
          <div>
            <label for="vf-period">Period</label>
            <input id="vf-period" type="text" placeholder="e.g. 2026-09-30 or Q3 2026">
          </div>
          <div>
            <label for="vf-source-doc">Source document</label>
            <input id="vf-source-doc" type="text" placeholder="e.g. balance_sheet_2026-09.pdf">
          </div>
        </div>
        <div class="form-row">
          <div style="flex:1;">
            <label for="vf-note">Note (optional)</label>
            <input id="vf-note" type="text" placeholder="e.g. reconciled by bookkeeper">
          </div>
          <div style="flex:0 0 auto; align-self:flex-end;">
            <button id="vf-save-button" class="primary" onclick="saveVerifiedFinancial()">Save entry</button>
          </div>
        </div>
        <div id="vf-form-error" class="error-banner hidden" style="margin-top:10px;"></div>
        <div id="vf-form-success" class="hint hidden" style="margin-top:8px; color:#065f46;"></div>
      </div>
    </div>

    <div class="panel">
      <h2>Case state</h2>
      <div id="case-state-pane"></div>
    </div>

    <div class="panel">
      <h2>Draft Roadmap</h2>
      <div id="roadmap-pane"></div>
    </div>

    <div class="panel">
      <h2>Strategist Brief (internal)</h2>
      <div id="strategist-brief-pane" class="section-content empty">—</div>
    </div>

    <div class="panel">
      <h2>Part 1 Business Growth Analysis (business_playbook)</h2>
      <div id="business-playbook-pane" class="section-content empty">—</div>
    </div>

    <div class="panel">
      <h2>Prior Full Diagnostic (if present)</h2>
      <div id="full-diagnostic-pane" class="section-content empty">—</div>
    </div>

    <div class="footer-note">
      Everything on this page is strategist-internal. Nothing displayed here is customer-visible.
    </div>

  </div>

</div>

<script>
'use strict';

const PASSWORD_KEY = "asksolomon_password";

function getPassword() { return sessionStorage.getItem(PASSWORD_KEY) || ""; }
function setPassword() {
  const pw = document.getElementById("password-input").value.trim();
  if (!pw) {
    document.getElementById("gate-error").textContent = "Password required.";
    return;
  }
  sessionStorage.setItem(PASSWORD_KEY, pw);
  document.getElementById("gate-error").textContent = "";
  showGateOrLoad();
}
function logout() {
  sessionStorage.removeItem(PASSWORD_KEY);
  showGateOrLoad();
}

function showGateOrLoad() {
  const hasPw = getPassword().length > 0;
  document.getElementById("gate").classList.toggle("hidden", hasPw);
  document.getElementById("load-panel").classList.toggle("hidden", !hasPw);
  if (!hasPw) {
    document.getElementById("case-content").classList.add("hidden");
    const pwInput = document.getElementById("password-input");
    if (pwInput) pwInput.focus();
  }
}

async function callApi(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-console-password": getPassword(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { success: false, error: "Non-JSON response: " + text.slice(0, 200) }; }
  return { status: res.status, data };
}

function showLoadError(msg) {
  const el = document.getElementById("load-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}
function clearLoadError() {
  document.getElementById("load-error").classList.add("hidden");
}

async function loadCase() {
  clearLoadError();
  const contactId = document.getElementById("contact-id").value.trim();
  if (!contactId) {
    showLoadError("Contact ID required.");
    return;
  }
  const btn = document.getElementById("load-button");
  btn.disabled = true;
  btn.textContent = "Loading…";
  try {
    const [bundleRes, auditRes] = await Promise.all([
      callApi("/asksolomon/case/load", { contactId }),
      callApi("/asksolomon/case/audit-gaps", { contactId }),
    ]);
    if (bundleRes.status === 401 || auditRes.status === 401) {
      logout();
      showLoadError("Unauthorized — password rejected. Re-enter and try again.");
      return;
    }
    if (!bundleRes.data.success) {
      showLoadError("Case load failed: " + (bundleRes.data.error || "unknown"));
      return;
    }
    renderCase(bundleRes.data, auditRes.data);
  } catch (err) {
    showLoadError("Request failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = "Load case";
  }
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function classificationPill(c) {
  const cls = c === "rehab" ? "pill-rehab" : c === "needs-attention" ? "pill-needs" : "pill-growth";
  return '<span class="pill ' + cls + '">' + esc(c) + '</span>';
}

function renderHeader(bundle) {
  const d = bundle.status && typeof bundle.status.day_since_paid_297 === "number"
    ? bundle.status.day_since_paid_297 + " day" + (bundle.status.day_since_paid_297 === 1 ? "" : "s")
    : "—";
  const oppFlags = Array.isArray(bundle.opportunity_flags) && bundle.opportunity_flags.length
    ? bundle.opportunity_flags.map(t => '<span class="tag opp">' + esc(t) + '</span>').join(" ")
    : '<span class="tag">none</span>';
  const name = bundle.business_name || "(no business name set)";
  const html = \`
    <div style="font-size:18px;font-weight:700;margin-bottom:6px;">\${esc(name)}</div>
    <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">contactId: <code>\${esc(bundle.contactId)}</code></div>
    <div class="status-row">
      <div class="status-item"><span class="k">Day since paid_297</span><span class="v">\${d}</span></div>
      <div class="status-item"><span class="k">Classification</span><span class="v">\${classificationPill(bundle.classification)}</span></div>
      <div class="status-item"><span class="k">Rehab flag</span><span class="v">\${bundle.rehab_flag ? "true" : "false"}</span></div>
    </div>
    <div style="margin-top:12px;">
      <div class="status-item" style="margin-bottom:4px;"><span class="k">Opportunity flags</span></div>
      <div class="tag-row">\${oppFlags}</div>
    </div>
  \`;
  document.getElementById("case-header").innerHTML = html;
}

function renderAudit(bundle, auditData) {
  const pane = document.getElementById("audit-pane");
  if (!auditData || !auditData.success) {
    const err = auditData && auditData.error ? auditData.error : "audit failed";
    pane.innerHTML = '<div class="error-banner">Audit failed: ' + esc(err) + '</div>';
    return;
  }
  const items = [];
  items.push('<div class="case-state-row">');
  items.push(stateTile("Intake present", auditData.intake_present));
  items.push(stateTile("Strategist brief present", auditData.strategist_brief_present));
  items.push(stateTile("Full diagnostic present", auditData.full_diagnostic_present));
  items.push('</div>');

  const vf = auditData.verified_financials || { present_metric_ids: [], missing_metric_ids: [], entries_count: 0 };
  items.push('<div style="margin-top:14px;font-size:12px;color:#6b7280;">Canonical metric coverage: '
    + esc(vf.present_metric_ids.length) + ' present / '
    + esc(vf.present_metric_ids.length + vf.missing_metric_ids.length) + ' total ('
    + esc(vf.entries_count) + ' entries written)</div>');
  pane.innerHTML = items.join("");
}

function stateTile(label, truthy) {
  return '<div class="case-state-item ' + (truthy ? "yes" : "no") + '">'
    + '<span class="k">' + esc(label) + '</span>'
    + '<span class="v">' + (truthy ? "yes" : "no") + '</span>'
    + '</div>';
}

// Module state for the write form: the current contactId, the latest
// entries_hash the server handed us, and the canonical metrics spec
// so we can shape-adapt the value input on each metric change.
let currentContactId = "";
let currentEntriesHash = "";
let canonicalMetricsSpec = {};

function renderVerifiedFinancials(bundle) {
  const pane = document.getElementById("verified-financials-pane");
  const vf = bundle.verified_financials || { entries: [], present_metric_ids: [], missing_metric_ids: [] };
  const canonical = bundle.canonical_metrics || {};
  const byMetric = {};
  for (const e of vf.entries || []) {
    if (e && e.metric_id) byMetric[e.metric_id] = e;
  }
  const cards = [];
  for (const id of Object.keys(canonical)) {
    const spec = canonical[id];
    const entry = byMetric[id];
    if (entry) {
      cards.push('<div class="metric-card">'
        + '<div class="label">' + esc(spec.label || id) + '</div>'
        + '<div class="value">' + esc(formatValue(entry.value, spec)) + '</div>'
        + '</div>');
    } else {
      cards.push('<div class="metric-card missing">'
        + '<div class="label">' + esc(spec.label || id) + '</div>'
        + '<div class="value">missing</div>'
        + '</div>');
    }
  }
  pane.innerHTML = '<div class="metric-grid">' + cards.join("") + '</div>';

  // Keep the write form synced with the current bundle.
  canonicalMetricsSpec = canonical;
  currentEntriesHash = vf.entries_hash || "";
  populateVfMetricDropdown(canonical);
  renderVfValueInput();
}

function populateVfMetricDropdown(canonical) {
  const sel = document.getElementById("vf-metric");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = "— pick a metric —";
  sel.appendChild(first);
  for (const id of Object.keys(canonical)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = (canonical[id].label || id);
    sel.appendChild(opt);
  }
  if (prev && canonical[prev]) sel.value = prev;
}

function renderVfValueInput() {
  const wrap = document.getElementById("vf-value-wrap");
  if (!wrap) return;
  const metricId = document.getElementById("vf-metric").value;
  const spec = metricId ? canonicalMetricsSpec[metricId] : null;

  if (!spec) {
    wrap.innerHTML =
      '<label for="vf-value">Value</label>' +
      '<input id="vf-value" type="text" placeholder="(pick a metric)" disabled>';
    return;
  }

  if (spec.shape === "ar_aging") {
    wrap.innerHTML =
      '<label>AR aging (' + esc(spec.unit || "USD") + ')</label>' +
      '<div style="display:flex; gap:8px;">' +
        '<input id="vf-value-d30"      type="number" min="0" step="0.01" placeholder="30 days">' +
        '<input id="vf-value-d60"      type="number" min="0" step="0.01" placeholder="60 days">' +
        '<input id="vf-value-d90plus"  type="number" min="0" step="0.01" placeholder="90+ days">' +
      '</div>';
    return;
  }

  if (spec.shape === "tax_enum") {
    wrap.innerHTML =
      '<label for="vf-value">Status</label>' +
      '<select id="vf-value">' +
        '<option value="">— pick —</option>' +
        '<option value="current">current</option>' +
        '<option value="behind">behind</option>' +
        '<option value="in_default">in_default</option>' +
      '</select>';
    return;
  }

  if (spec.shape === "text") {
    wrap.innerHTML =
      '<label for="vf-value">' + esc(spec.label || "Value") + '</label>' +
      '<input id="vf-value" type="text" placeholder="free-form text">';
    return;
  }

  // Default: number
  const unitHint = spec.unit ? " (" + esc(spec.unit) + ")" : "";
  wrap.innerHTML =
    '<label for="vf-value">Value' + unitHint + '</label>' +
    '<input id="vf-value" type="number" step="0.01" placeholder="e.g. 184221">';
}

function readVfValueFromForm(metricId) {
  const spec = canonicalMetricsSpec[metricId];
  if (!spec) return { ok: false, error: "pick a metric" };

  if (spec.shape === "ar_aging") {
    const d30 = parseFloat(document.getElementById("vf-value-d30").value);
    const d60 = parseFloat(document.getElementById("vf-value-d60").value);
    const d90 = parseFloat(document.getElementById("vf-value-d90plus").value);
    if (![d30, d60, d90].every(Number.isFinite)) {
      return { ok: false, error: "AR aging requires three numeric values" };
    }
    return { ok: true, value: { d30, d60, d90_plus: d90 } };
  }
  if (spec.shape === "tax_enum") {
    const v = document.getElementById("vf-value").value;
    if (!v) return { ok: false, error: "pick a status" };
    return { ok: true, value: v };
  }
  if (spec.shape === "text") {
    const v = document.getElementById("vf-value").value.trim();
    if (!v) return { ok: false, error: "value required" };
    return { ok: true, value: v };
  }
  // number
  const v = parseFloat(document.getElementById("vf-value").value);
  if (!Number.isFinite(v)) return { ok: false, error: "numeric value required" };
  return { ok: true, value: v };
}

function showVfError(msg, offerRefresh) {
  const el = document.getElementById("vf-form-error");
  el.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = msg;
  el.appendChild(span);
  if (offerRefresh) {
    el.appendChild(document.createTextNode(" "));
    const btn = document.createElement("button");
    btn.textContent = "Refresh now";
    btn.className = "btn";
    btn.style.marginLeft = "8px";
    btn.onclick = () => { clearVfMessages(); loadCase(); };
    el.appendChild(btn);
  }
  el.classList.remove("hidden");
  document.getElementById("vf-form-success").classList.add("hidden");
}
function showVfSuccess(msg) {
  const el = document.getElementById("vf-form-success");
  el.textContent = msg;
  el.classList.remove("hidden");
  document.getElementById("vf-form-error").classList.add("hidden");
}
function clearVfMessages() {
  document.getElementById("vf-form-error").classList.add("hidden");
  document.getElementById("vf-form-success").classList.add("hidden");
}

async function saveVerifiedFinancial() {
  clearVfMessages();
  if (!currentContactId) {
    showVfError("Load a case first.", false);
    return;
  }
  const metricId = document.getElementById("vf-metric").value;
  if (!metricId) { showVfError("Pick a metric.", false); return; }
  const period = document.getElementById("vf-period").value.trim();
  const sourceDoc = document.getElementById("vf-source-doc").value.trim();
  const note = document.getElementById("vf-note").value.trim();
  if (!period) { showVfError("Period required (e.g. 2026-09-30).", false); return; }
  if (!sourceDoc) { showVfError("Source document required.", false); return; }

  const v = readVfValueFromForm(metricId);
  if (!v.ok) { showVfError(v.error, false); return; }

  const entry = { metric_id: metricId, value: v.value, period, source_doc: sourceDoc };
  if (note) entry.note = note;

  const btn = document.getElementById("vf-save-button");
  btn.disabled = true;
  const prevLabel = btn.textContent;
  btn.textContent = "Saving…";
  try {
    const { status, data } = await callApi("/asksolomon/case/verified-financials", {
      contactId: currentContactId,
      entry,
      expected_entries_hash: currentEntriesHash,
    });
    if (status === 401) {
      logout();
      showVfError("Unauthorized — password rejected.", false);
      return;
    }
    if (status === 409 || data.conflict === true) {
      // Someone else wrote first — bring the UI back in sync.
      currentEntriesHash = data.current_entries_hash || currentEntriesHash;
      showVfError("Another save landed first — refresh and try again.", true);
      return;
    }
    if (!data.success) {
      showVfError("Save failed: " + (data.error || "unknown"), false);
      return;
    }
    currentEntriesHash = data.entries_hash || "";
    // Rebuild the metric cards from the server's authoritative array
    // without a round-trip to re-load everything else.
    renderVerifiedFinancials({
      verified_financials: {
        entries: data.entries,
        entries_hash: currentEntriesHash,
      },
      canonical_metrics: canonicalMetricsSpec,
    });
    showVfSuccess('Saved "' + (canonicalMetricsSpec[metricId]?.label || metricId) + '".');
    // Clear value / note / period / source_doc for the next entry; keep
    // the metric picker so the strategist can edit the same slot again.
    document.getElementById("vf-period").value = "";
    document.getElementById("vf-source-doc").value = "";
    document.getElementById("vf-note").value = "";
    renderVfValueInput();
  } catch (err) {
    showVfError("Request failed: " + (err && err.message ? err.message : String(err)), false);
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel;
  }
}

function formatValue(v, spec) {
  if (v === null || v === undefined) return "—";
  if (spec && spec.shape === "ar_aging" && typeof v === "object") {
    return "30: " + (v.d30 ?? "—") + "  ·  60: " + (v.d60 ?? "—") + "  ·  90+: " + (v.d90_plus ?? "—");
  }
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

function renderCaseState(bundle) {
  const pane = document.getElementById("case-state-pane");
  const s = bundle.case_state || {};
  const parts = [];
  parts.push(stateTile("Financial request list drafted", s.financial_request_list_drafted));
  parts.push(stateTile("Growth plan draft present", s.growth_plan_draft_present));
  parts.push(stateTile("Prep brief present", s.prep_brief_present));
  parts.push(stateTile("Red-team report present", s.red_team_report_present));
  parts.push('<div class="case-state-item"><span class="k">Decisions recorded</span><span class="v">'
    + esc(s.decisions_count ?? 0) + '</span></div>');
  parts.push('<div class="case-state-item"><span class="k">Services selected</span><span class="v">'
    + (Array.isArray(s.services_selected) && s.services_selected.length
      ? s.services_selected.map(id => '<span class="tag">' + esc(id) + '</span>').join(" ")
      : "none") + '</span></div>');
  pane.innerHTML = '<div class="case-state-row">' + parts.join("") + '</div>';
}

function renderContentPane(id, content) {
  const pane = document.getElementById(id);
  if (!content || !String(content).trim()) {
    pane.className = "section-content empty";
    pane.textContent = "— not present —";
    return;
  }
  pane.className = "section-content";
  pane.textContent = content;
}

function renderCase(bundle, auditData) {
  document.getElementById("case-content").classList.remove("hidden");
  currentContactId = bundle.contactId || "";
  renderHeader(bundle);
  renderAudit(bundle, auditData);
  renderVerifiedFinancials(bundle);
  renderCaseState(bundle);
  renderRoadmap(bundle);
  const intake = bundle.intake || {};
  renderContentPane("strategist-brief-pane", intake.strategist_brief);
  renderContentPane("business-playbook-pane", intake.business_playbook);
  renderContentPane("full-diagnostic-pane", intake.full_diagnostic);
}

// -------- Roadmap panel (PR 5b) --------

const DRAFT_BANNER = "⚠️ DRAFT · INTERNAL PREP ONLY · NOT FOR CUSTOMER DELIVERY ⚠️";

function renderRoadmap(bundle) {
  const pane = document.getElementById("roadmap-pane");
  const rd = bundle.roadmap_draft || { present: false, content: "" };
  if (!rd.present || !rd.content) {
    pane.innerHTML = ''
      + '<div class="generate-row">'
        + '<div>No draft yet. Generating pulls Part 1, strategist brief, intake, verified financials, and the services catalog, and runs the 8-section prompt.</div>'
        + '<button class="primary" onclick="generateRoadmap()" id="generate-roadmap-btn">Generate draft</button>'
      + '</div>'
      + '<div id="generate-roadmap-error" class="error-banner hidden" style="margin-top:10px;"></div>';
    return;
  }
  renderDraftContent(pane, rd.content);
}

function renderDraftContent(pane, content) {
  const parsed = parseDraftOnClient(content);
  const chunks = [];
  chunks.push('<div class="draft-banner">' + esc(DRAFT_BANNER) + '</div>');
  if (!parsed.sections.length) {
    // Fallback: Claude produced a draft that didn't parse into sections.
    // Show the raw content and let the strategist regenerate.
    chunks.push('<div class="section-content">' + esc(content) + '</div>');
  } else {
    for (const s of parsed.sections) {
      const num = s.n;
      chunks.push(
        '<div class="section-block" data-section-n="' + esc(num) + '">'
        + '<div class="section-header">'
          + '<div>'
            + '<div class="num">Section ' + esc(num) + '</div>'
            + '<div class="title">' + esc(s.title) + '</div>'
          + '</div>'
          + '<div class="section-actions">'
            + '<button onclick="startEditSection(' + esc(num) + ')">Edit</button>'
          + '</div>'
        + '</div>'
        + '<div class="section-body" id="section-body-' + esc(num) + '">'
          + (s.body ? esc(s.body) : '<em style="color:#9ca3af;">(empty)</em>')
        + '</div>'
      + '</div>'
      );
    }
  }
  chunks.push('<div class="generate-row" style="margin-top:12px;">');
  chunks.push('<div>Re-generating replaces the entire draft. Match-services replaces only Section 7. Per-section edits above do not touch other sections.</div>');
  chunks.push('<div style="display:flex; gap:8px;">');
  chunks.push('<button onclick="matchServices()" id="match-services-btn">Match services → Section 7</button>');
  chunks.push('<button onclick="generateRoadmap()" id="generate-roadmap-btn">Re-generate draft</button>');
  chunks.push('</div>');
  chunks.push('</div>');
  chunks.push('<div id="generate-roadmap-error" class="error-banner hidden" style="margin-top:10px;"></div>');
  pane.innerHTML = chunks.join("");
}

async function matchServices() {
  if (!currentContactId) return;
  const btn = document.getElementById("match-services-btn");
  if (!btn) return;
  showGenerateRoadmapError(null);
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Matching…";
  try {
    const { status, data } = await callApi("/asksolomon/case/match-services", {
      contactId: currentContactId,
      mode: "write",
    });
    if (status === 401) { logout(); return; }
    if (!data.success) {
      showGenerateRoadmapError("Match failed: " + (data.error || "unknown"));
      return;
    }
    renderDraftContent(document.getElementById("roadmap-pane"), data.draft);
    const n = (data.matches && data.matches.included) ? data.matches.included.length : 0;
    const nx = (data.matches && data.matches.excluded) ? data.matches.excluded.length : 0;
    showGenerateRoadmapError(
      "Section 7 updated. " + n + " recommended, " + nx + " considered-but-excluded. "
      + "Catalog version: " + (data.catalog_version || "unknown") + ".",
    );
  } catch (err) {
    showGenerateRoadmapError("Request failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

// Client-side parser mirrors the server's parseDraftSections() signature
// so the UI can render per-section without a second round-trip.
function parseDraftOnClient(text) {
  const re = /^##\s+Section\s+(\d+)\s*[—-]\s*(.+?)\s*$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    matches.push({ n: Number(m[1]), title: m[2], start: m.index, headerEnd: re.lastIndex });
  }
  const sections = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const body = text.slice(cur.headerEnd, next ? next.start : text.length)
      .replace(/^[ \t]*\n/, "").replace(/\s+$/, "");
    sections.push({ n: cur.n, title: cur.title, body });
  }
  return { sections };
}

// Codex P2 on #96 (finding 2): the previous Cancel handler
// interpolated the pre-edit text into an onclick="…" attribute via
// JSON.stringify, which starts with a double quote and prematurely
// terminated the attribute whenever a section had non-empty content.
// Store the snapshot in a module-local map instead; Cancel reads it
// out by section number.
const sectionSnapshots = {};

function startEditSection(n) {
  const block = document.querySelector('[data-section-n="' + n + '"]');
  if (!block) return;
  const body = document.getElementById("section-body-" + n);
  const currentText = (body.textContent || "").trim();
  sectionSnapshots[n] = currentText;
  body.classList.add("editing");
  body.innerHTML = '<textarea id="section-edit-' + n + '">' + esc(currentText) + '</textarea>';
  // Replace Edit with Save / Cancel.
  const actions = block.querySelector(".section-actions");
  actions.innerHTML =
    '<button onclick="cancelEditSection(' + n + ')">Cancel</button>' +
    '<button class="primary" onclick="saveEditSection(' + n + ')">Save</button>';
}

function cancelEditSection(n) {
  const previousText = sectionSnapshots[n] || "";
  delete sectionSnapshots[n];
  const body = document.getElementById("section-body-" + n);
  body.classList.remove("editing");
  body.innerHTML = previousText ? esc(previousText) : '<em style="color:#9ca3af;">(empty)</em>';
  const block = document.querySelector('[data-section-n="' + n + '"]');
  const actions = block.querySelector(".section-actions");
  actions.innerHTML = '<button onclick="startEditSection(' + n + ')">Edit</button>';
}

async function saveEditSection(n) {
  const ta = document.getElementById("section-edit-" + n);
  if (!ta) return;
  const newContent = ta.value;
  const block = document.querySelector('[data-section-n="' + n + '"]');
  const actions = block.querySelector(".section-actions");
  actions.innerHTML = '<span class="loader">Saving…</span>';
  try {
    const { status, data } = await callApi("/asksolomon/case/update-roadmap-section", {
      contactId: currentContactId,
      section_number: n,
      new_content: newContent,
    });
    if (status === 401) { logout(); return; }
    if (!data.success) {
      actions.innerHTML = '<button class="primary" onclick="saveEditSection(' + n + ')">Save</button>';
      alert("Save failed: " + (data.error || "unknown"));
      return;
    }
    // Server returned the full updated draft. Rebuild the panel from
    // scratch — simpler and avoids drift if the parse changes.
    renderDraftContent(document.getElementById("roadmap-pane"), data.draft);
  } catch (err) {
    actions.innerHTML = '<button class="primary" onclick="saveEditSection(' + n + ')">Save</button>';
    alert("Request failed: " + (err && err.message ? err.message : String(err)));
  }
}

async function generateRoadmap() {
  if (!currentContactId) return;
  const btn = document.getElementById("generate-roadmap-btn");
  if (!btn) return;
  // Codex P2 on #96 (finding 3): the error banner captured before
  // the fetch gets detached when renderDraftContent replaces the
  // pane. Clear-by-id BEFORE and show-by-id AFTER so the handler
  // writes to whichever banner node is currently in the DOM.
  showGenerateRoadmapError(null);
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating… (30–60s)";
  try {
    const { status, data } = await callApi("/asksolomon/case/generate-roadmap-draft", {
      contactId: currentContactId,
    });
    if (status === 401) { logout(); return; }
    if (!data.success) {
      showGenerateRoadmapError("Generate failed: " + (data.error || "unknown"));
      return;
    }
    renderDraftContent(document.getElementById("roadmap-pane"), data.draft);
    if (data.drafted_tag_applied === false) {
      showGenerateRoadmapError(
        "Draft saved, but the swot_growth_plan_drafted tag didn't apply. Re-run to retry.",
      );
    }
  } catch (err) {
    showGenerateRoadmapError("Request failed: " + (err && err.message ? err.message : String(err)));
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function showGenerateRoadmapError(msg) {
  const el = document.getElementById("generate-roadmap-error");
  if (!el) return;
  if (!msg) { el.classList.add("hidden"); el.textContent = ""; return; }
  el.textContent = msg;
  el.classList.remove("hidden");
}

document.getElementById("password-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") setPassword();
});
document.getElementById("contact-id")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadCase();
});

showGateOrLoad();
</script>

</body>
</html>`;
