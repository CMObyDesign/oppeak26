// Phase 3B: strategist review UI.
//
// A one-page, no-build vanilla-JS console the strategist uses to
// attach structured feedback to a report's findings. Reads via
//   GET /strategist/report/{reportId}      → report + feedback
// Writes via
//   POST /feedback                         → one feedback row
// Both API calls carry x-console-password (set once per browser via
// a password prompt and kept in sessionStorage).
//
// Nothing in this layer promotes feedback into the rubric. That's
// Phase 3C and is human-gated by design.
//
// The page is served by GET /strategist. The {{FEEDBACK_TYPES_JSON}}
// placeholder is replaced at request time with the canonical list
// from worker/src/db.js so the dropdown never drifts from the vocabulary.

export const STRATEGIST_PAGE_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strategist review — CFO By Design</title>
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
  .brand { font-weight: 700; font-size: 16px; }
  .brand span { color: #92400e; }
  .subbrand { font-size: 11px; color: #6b7280; letter-spacing: 1.5px; text-transform: uppercase; margin-left: 12px; }
  .wrap { max-width: 920px; margin: 24px auto; padding: 0 20px; }
  .card {
    background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
    padding: 20px; margin-bottom: 16px;
  }
  h1 { font-size: 22px; margin: 0 0 8px; }
  h2 { font-size: 15px; margin: 0 0 12px; color: #374151; text-transform: uppercase; letter-spacing: 1px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  label { display: block; font-size: 12px; font-weight: 600; color: #4b5563; margin: 10px 0 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  input[type="text"], textarea, select {
    width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #d1d5db;
    font-family: inherit; font-size: 13px; background: #fff; color: #1a1a1a;
  }
  textarea { min-height: 60px; resize: vertical; }
  .row { display: flex; gap: 10px; align-items: center; }
  .row > input[type="text"] { flex: 1; }
  button {
    padding: 8px 14px; border-radius: 6px; border: 1px solid #d1d5db;
    background: #fff; color: #1a1a1a; font-size: 13px; font-weight: 500;
    cursor: pointer; font-family: inherit;
  }
  button:hover { background: #f3f4f6; }
  button.primary { background: #1a1a1a; color: #fff; border-color: #1a1a1a; }
  button.primary:hover { background: #374151; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .meta { font-size: 12px; color: #6b7280; }
  .tag {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    background: #eef2ff; color: #3730a3; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.5px; margin-right: 6px;
  }
  .tag.rehab { background: #fef2f2; color: #991b1b; }
  .tag.needs-attention { background: #fef3c7; color: #92400e; }
  .tag.growth { background: #ecfdf5; color: #065f46; }
  .finding {
    border-left: 3px solid #93c5fd; padding: 10px 14px; margin: 10px 0;
    background: #f8fafc; border-radius: 0 6px 6px 0;
  }
  .finding .finding-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #6b7280; }
  .finding .finding-text { margin-top: 4px; }
  .feedback-item {
    border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px;
    margin: 8px 0; background: #fff;
  }
  .feedback-item .fb-head { display: flex; justify-content: space-between; align-items: center; }
  .pending { color: #92400e; font-weight: 600; }
  .approved { color: #065f46; font-weight: 600; }
  .status { padding: 10px 14px; border-radius: 6px; margin: 12px 0; display: none; }
  .status.show { display: block; }
  .status.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .status.ok    { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .hint { font-size: 12px; color: #6b7280; margin-top: 4px; }
  details > summary { cursor: pointer; font-weight: 600; color: #374151; }
  .fb-form { display: none; margin-top: 10px; border-top: 1px dashed #d1d5db; padding-top: 10px; }
  .fb-form.open { display: block; }
</style>
</head>
<body>
<div class="topbar">
  <div><span class="brand">CFO By <span>Design</span></span><span class="subbrand">Strategist review</span></div>
  <div class="meta" id="pw-state">Password: not set</div>
</div>

<div class="wrap">
  <div class="card">
    <h1>Strategist review</h1>
    <p class="meta">Attach structured feedback to a report's findings. Feedback is captured only — rule promotion is a separate, human-gated step.</p>
    <label>Report ID</label>
    <div class="row">
      <input type="text" id="report-id" placeholder="paste a report_id (UUID) from /report/{contactId}" autocomplete="off" />
      <button class="primary" id="load-btn">Load</button>
      <button id="pw-btn" title="Set console password">Set password</button>
    </div>
    <div class="status" id="status"></div>
  </div>

  <div id="report-pane"></div>
</div>

<script>
(function () {
  "use strict";
  var FEEDBACK_TYPES = {{FEEDBACK_TYPES_JSON}};
  var PW_KEY = "solomon.console.pw";

  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("status");
  var reportPane = $("report-pane");
  var pwState = $("pw-state");

  function getPw() { try { return sessionStorage.getItem(PW_KEY) || ""; } catch (e) { return ""; } }
  function setPw(v) { try { if (v) sessionStorage.setItem(PW_KEY, v); else sessionStorage.removeItem(PW_KEY); } catch (e) {} refreshPwState(); }
  function refreshPwState() { pwState.textContent = getPw() ? "Password: set" : "Password: not set"; }
  refreshPwState();

  function showStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "status show " + (kind || "ok");
    if (kind === "ok") setTimeout(function () { statusEl.className = "status"; }, 2500);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function apiHeaders() {
    return { "content-type": "application/json", "x-console-password": getPw() };
  }

  $("pw-btn").addEventListener("click", function () {
    var current = getPw();
    var next = window.prompt("Console password (stored only in this browser tab, never sent to anyone but this worker):", current);
    if (next === null) return;
    setPw(next.trim());
    showStatus(next ? "Password saved for this tab." : "Password cleared.", "ok");
  });

  $("load-btn").addEventListener("click", function () { void loadReport(); });

  async function loadReport() {
    var reportId = $("report-id").value.trim();
    if (!reportId) { showStatus("Paste a report_id first.", "error"); return; }
    if (!getPw()) { showStatus("Set the console password first.", "error"); return; }
    reportPane.innerHTML = '<div class="card meta">Loading…</div>';
    try {
      var res = await fetch("/strategist/report/" + encodeURIComponent(reportId), {
        method: "GET",
        headers: apiHeaders(),
      });
      if (res.status === 401) { showStatus("Unauthorized — check the password.", "error"); reportPane.innerHTML = ""; return; }
      if (res.status === 404) { showStatus("No report with that ID.", "error"); reportPane.innerHTML = ""; return; }
      var body = await res.json();
      if (!body.success) { showStatus("Load failed: " + (body.error || res.status), "error"); reportPane.innerHTML = ""; return; }
      renderReport(body.report, body.feedback || []);
      showStatus("Loaded.", "ok");
    } catch (err) {
      showStatus("Load failed: " + (err && err.message ? err.message : err), "error");
      reportPane.innerHTML = "";
    }
  }

  function renderReport(report, feedback) {
    var created = report.created_at ? new Date(report.created_at).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "unknown";
    var cls = report.classification || "unknown";
    var tag = '<span class="tag ' + esc(cls) + '">' + esc(cls) + '</span>';
    var findings = (report.diagnostic && Array.isArray(report.diagnostic.structured_findings))
      ? report.diagnostic.structured_findings
      : [];
    var html = "";
    html += '<div class="card">';
    html += '  <h2>Report</h2>';
    html += '  <div>' + tag + '<span class="meta">tier=' + esc(report.tier) + ' · v' + esc(report.report_version) + ' · created ' + esc(created) + '</span></div>';
    html += '  <div class="meta" style="margin-top:4px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">' + esc(report.id) + '</div>';
    if (!findings.length) {
      html += '  <p class="meta" style="margin-top:12px;">No structured findings on this report. You can still attach whole-report feedback.</p>';
    }
    html += renderFeedbackForm({ scopeLabel: "whole report", findingId: null, formKey: "whole" });
    html += '</div>';

    html += '<div class="card"><h2>Structured findings</h2>';
    if (!findings.length) {
      html += '<p class="meta">(none)</p>';
    } else {
      findings.forEach(function (f, i) {
        var fid = f.finding_id || ("finding-" + i);
        html += '<div class="finding">';
        html += '  <div class="finding-id">' + esc(fid) + (f.severity ? ' · severity: ' + esc(f.severity) : "") + '</div>';
        html += '  <div class="finding-text">' + esc(f.text || f.summary || JSON.stringify(f).slice(0, 200)) + '</div>';
        html += '  <div style="margin-top:8px;"><button data-toggle="fb-form-' + esc(fid) + '">Add feedback</button></div>';
        html += renderFeedbackForm({ scopeLabel: fid, findingId: fid, formKey: fid, originalOutput: f.text || f.summary || "" });
        html += '</div>';
      });
    }
    html += '</div>';

    html += '<div class="card"><h2>Captured feedback</h2>';
    if (!feedback.length) {
      html += '<p class="meta">(none yet)</p>';
    } else {
      feedback.forEach(function (fb) {
        html += '<div class="feedback-item">';
        html += '  <div class="fb-head">';
        html += '    <div><strong>' + esc(fb.feedback_type) + '</strong>' + (fb.finding_id ? ' <span class="meta">on ' + esc(fb.finding_id) + '</span>' : ' <span class="meta">(whole report)</span>') + '</div>';
        html += '    <div class="' + (fb.approved_for_learning ? "approved" : "pending") + '">' + (fb.approved_for_learning ? "approved" : "pending") + '</div>';
        html += '  </div>';
        if (fb.reason)              html += '  <div class="meta" style="margin-top:4px;"><strong>Reason:</strong> ' + esc(fb.reason) + '</div>';
        if (fb.strategist_revision) html += '  <div class="meta" style="margin-top:4px;"><strong>Should say:</strong> ' + esc(fb.strategist_revision) + '</div>';
        if (fb.candidate_rule)      html += '  <div class="meta" style="margin-top:4px;"><strong>Candidate rule:</strong> ' + esc(fb.candidate_rule) + '</div>';
        html += '  <div class="meta" style="margin-top:4px;">' + esc(fb.created_by || "unknown") + ' · ' + esc(new Date(fb.created_at).toISOString().slice(0, 10)) + '</div>';
        html += '</div>';
      });
    }
    html += '</div>';

    reportPane.innerHTML = html;
    wireForms(report.id);
  }

  function renderFeedbackForm(opts) {
    var k = opts.formKey;
    var h = "";
    h += '<div class="fb-form" id="fb-form-' + esc(k) + '">';
    h += '  <label>Feedback type</label>';
    h += '  <select data-form="' + esc(k) + '" data-field="feedback_type">';
    FEEDBACK_TYPES.forEach(function (t) { h += '<option value="' + esc(t) + '">' + esc(t) + '</option>'; });
    h += '  </select>';
    h += '  <label>Original output (what the report actually said)</label>';
    h += '  <textarea data-form="' + esc(k) + '" data-field="original_output" placeholder="paste the sentence or finding that was wrong">' + esc(opts.originalOutput || "") + '</textarea>';
    h += '  <label>Strategist revision (what it should have said)</label>';
    h += '  <textarea data-form="' + esc(k) + '" data-field="strategist_revision" placeholder="rewrite in correct, calibrated language"></textarea>';
    h += '  <label>Reason</label>';
    h += '  <textarea data-form="' + esc(k) + '" data-field="reason" placeholder="why the original was wrong"></textarea>';
    h += '  <label>Candidate rule (optional)</label>';
    h += '  <textarea data-form="' + esc(k) + '" data-field="candidate_rule" placeholder="a one-sentence rubric rule we might promote in Phase 3C"></textarea>';
    h += '  <div class="hint">Scope: <strong>' + esc(opts.scopeLabel) + '</strong>. Nothing here trains Solomon automatically — this stays pending until a human approves it in Phase 3C.</div>';
    h += '  <div style="margin-top:10px;"><button class="primary" data-submit="' + esc(k) + '" data-finding-id="' + esc(opts.findingId == null ? "" : opts.findingId) + '">Save feedback</button></div>';
    h += '</div>';
    return h;
  }

  function wireForms(reportId) {
    document.querySelectorAll("[data-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var el = document.getElementById(btn.getAttribute("data-toggle"));
        if (el) el.classList.toggle("open");
      });
    });
    document.querySelectorAll("[data-submit]").forEach(function (btn) {
      btn.addEventListener("click", function () { void submitFeedback(btn, reportId); });
    });
    // The whole-report form is always visible — toggle it open by default.
    var wholeForm = document.getElementById("fb-form-whole");
    if (wholeForm) wholeForm.classList.add("open");
  }

  async function submitFeedback(btn, reportId) {
    var formKey = btn.getAttribute("data-submit");
    var findingId = btn.getAttribute("data-finding-id");
    var fields = {};
    document.querySelectorAll('[data-form="' + CSS.escape(formKey) + '"]').forEach(function (el) {
      fields[el.getAttribute("data-field")] = el.value;
    });
    var body = {
      report_id: reportId,
      feedback_type: fields.feedback_type,
      original_output: fields.original_output || null,
      strategist_revision: fields.strategist_revision || null,
      reason: fields.reason || null,
      candidate_rule: fields.candidate_rule || null,
    };
    if (findingId) body.finding_id = findingId;
    btn.disabled = true;
    try {
      var res = await fetch("/feedback", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(body),
      });
      var payload = await res.json().catch(function () { return {}; });
      if (res.status === 401) { showStatus("Unauthorized — check the password.", "error"); return; }
      if (!res.ok || !payload.success) {
        showStatus("Save failed: " + (payload.error || ("HTTP " + res.status)), "error");
        return;
      }
      if (payload.skipped) {
        showStatus("Captured, but D1 isn't wired in this environment yet — nothing was persisted.", "error");
        return;
      }
      showStatus("Feedback saved (" + body.feedback_type + ").", "ok");
      await loadReport();
    } catch (err) {
      showStatus("Save failed: " + (err && err.message ? err.message : err), "error");
    } finally {
      btn.disabled = false;
    }
  }
})();
</script>
</body>
</html>`;

/**
 * Render the strategist review page with the FEEDBACK_TYPES vocabulary
 * baked in, so the dropdown stays in lockstep with the server-enforced
 * set and the UI can't drift to a stale list.
 */
export function renderStrategistPage(feedbackTypes) {
  const types = Array.isArray(feedbackTypes) ? feedbackTypes : [];
  // JSON.stringify alone leaves "</script>" and "<!--" intact, so a
  // category name containing a </script> sequence would terminate the
  // page's inline script. FEEDBACK_TYPES is frozen in code today so
  // this is defense-in-depth, but the escape is cheap and makes the
  // page safe even if the list ever comes from an untrusted source.
  const safeJson = JSON.stringify(types)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
  return STRATEGIST_PAGE_TEMPLATE.replace("{{FEEDBACK_TYPES_JSON}}", safeJson);
}
