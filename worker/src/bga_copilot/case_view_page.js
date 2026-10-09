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
    </div>

    <div class="panel">
      <h2>Case state</h2>
      <div id="case-state-pane"></div>
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
  renderHeader(bundle);
  renderAudit(bundle, auditData);
  renderVerifiedFinancials(bundle);
  renderCaseState(bundle);
  const intake = bundle.intake || {};
  renderContentPane("strategist-brief-pane", intake.strategist_brief);
  renderContentPane("business-playbook-pane", intake.business_playbook);
  renderContentPane("full-diagnostic-pane", intake.full_diagnostic);
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
