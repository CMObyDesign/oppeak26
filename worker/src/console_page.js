// Ask Solomon — internal training & testing console for the SWOT Engine.
// Exported as a string constant so the Workers runtime (no filesystem) can serve it.
// Light, clean, simple. Vanilla JS, no build step.

export const CONSOLE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ask Solomon — CFO By Design</title>
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
  button.danger { color: #b91c1c; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }

  .layout { display: grid; grid-template-columns: 280px 1fr; min-height: calc(100vh - 53px); }

  .sidebar {
    background: #ffffff; border-right: 1px solid #e5e7eb; overflow-y: auto;
    padding: 16px; max-height: calc(100vh - 53px);
  }
  .sidebar h3 {
    font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7280;
    margin: 16px 0 8px; font-weight: 600;
  }
  .sidebar h3:first-child { margin-top: 0; }
  .sidebar-entry {
    padding: 8px 10px; margin: 2px 0; border-radius: 4px; cursor: pointer;
    font-size: 12px; color: #374151;
  }
  .sidebar-entry:hover { background: #f3f4f6; }
  .sidebar-entry.active { background: #fef3c7; color: #92400e; }
  .sidebar-entry .meta { font-size: 10px; color: #9ca3af; margin-top: 2px; }
  .sidebar-empty { font-size: 12px; color: #9ca3af; padding: 8px 10px; font-style: italic; }
  .sidebar-actions { display: flex; gap: 6px; margin-top: 8px; }
  .sidebar-actions button { font-size: 11px; padding: 4px 8px; }

  .main {
    padding: 24px; overflow-y: auto; max-height: calc(100vh - 53px);
  }
  .panel {
    background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;
    margin-bottom: 16px;
  }
  .panel h2 {
    font-size: 13px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7280;
    margin: 0 0 12px; font-weight: 600;
  }
  .form-row { display: flex; gap: 12px; margin-bottom: 12px; }
  .form-row > * { flex: 1; }
  label { display: block; font-size: 12px; color: #374151; margin-bottom: 4px; font-weight: 500; }
  input[type="text"], input[type="email"], input[type="password"], select, textarea {
    width: 100%; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px;
    font-size: 13px; font-family: inherit; color: #1a1a1a; background: #ffffff;
  }
  textarea { resize: vertical; line-height: 1.5; }
  textarea.code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
  details { margin-top: 8px; }
  details summary { cursor: pointer; font-size: 12px; color: #6b7280; padding: 4px 0; }
  details[open] summary { margin-bottom: 8px; }

  .run-button-row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
  .run-button-row button { font-size: 14px; padding: 10px 20px; }
  .run-status { font-size: 12px; color: #6b7280; }

  .output-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .output-card {
    background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px;
  }
  .output-card h3 {
    font-size: 10px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7280;
    margin: 0 0 8px; font-weight: 600;
  }
  .mode-btn {
    padding: 4px 10px; border-radius: 4px; border: 1px solid #d1d5db;
    background: #ffffff; font-size: 11px; cursor: pointer; color: #6b7280;
  }
  .mode-btn:hover { background: #f3f4f6; }
  .mode-btn.active { background: #1a1a1a; color: #ffffff; border-color: #1a1a1a; }

  .badge {
    display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 10px;
    font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
    background: #fef3c7; color: #92400e; margin-right: 8px;
  }
  .badge.rehab { background: #fee2e2; color: #b91c1c; }
  .badge.urgent { background: #fed7aa; color: #c2410c; }
  .badge.growth { background: #fef3c7; color: #92400e; }
  .badge.strong { background: #d1fae5; color: #065f46; }
  .flag-tag {
    display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 4px;
    background: #ede9fe; color: #5b21b6; margin: 2px 4px 2px 0; font-family: ui-monospace, monospace;
  }
  .report-preview {
    background: #ffffff; padding: 16px; border-radius: 6px; border: 1px solid #e5e7eb;
    max-height: 500px; overflow-y: auto;
  }
  .strategist-brief {
    background: #fef3c7; padding: 14px; border-left: 4px solid #92400e; border-radius: 4px;
    font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px;
    white-space: pre-wrap; line-height: 1.6; color: #1a1a1a; max-height: 400px; overflow-y: auto;
  }
  .email-blurb {
    background: #f0f9ff; padding: 14px; border-left: 4px solid #0369a1; border-radius: 4px;
    font-family: Georgia, serif; font-size: 14px; line-height: 1.6; color: #1a1a1a;
  }

  .gate {
    position: fixed; inset: 0; background: rgba(250, 250, 250, 0.95);
    display: flex; align-items: center; justify-content: center; z-index: 100;
  }
  .gate-card {
    background: #ffffff; padding: 32px; border-radius: 12px; border: 1px solid #e5e7eb;
    max-width: 360px; width: 90%; text-align: center;
  }
  .gate-card h1 { font-size: 18px; margin: 0 0 8px; }
  .gate-card p { font-size: 13px; color: #6b7280; margin: 0 0 16px; }
  .gate-card input { margin-bottom: 12px; }
  .gate-card .error { color: #b91c1c; font-size: 12px; margin-top: 8px; }

  .toast {
    position: fixed; bottom: 24px; right: 24px; padding: 12px 16px;
    background: #1a1a1a; color: #ffffff; border-radius: 6px; font-size: 13px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 200;
  }
  .toast.error { background: #b91c1c; }
  .toast.success { background: #065f46; }

  .empty-state { text-align: center; padding: 40px 20px; color: #9ca3af; font-size: 13px; }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { max-height: 200px; }
    .output-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<div class="topbar">
  <div>
    <span class="brand">Ask <span>Solomon</span></span>
    <span class="subbrand">Internal Training & Testing</span>
  </div>
  <div class="topbar-right">
    <span id="connection-status" class="run-status">Idle</span>
    <button onclick="exportLearnings()" title="Download your saved rubrics and bookmarks as JSON">📤 Export Learnings</button>
    <button onclick="importLearnings()" title="Load a previously exported JSON">📥 Import</button>
    <button onclick="logout()" class="danger">Logout</button>
  </div>
</div>

<div class="layout">

  <aside class="sidebar">
    <h3>Session History (last 20)</h3>
    <div id="history-list"></div>
    <div class="sidebar-actions">
      <button onclick="clearHistory()" class="danger">Clear history</button>
    </div>

    <h3>Saved Rubrics</h3>
    <div id="saved-rubrics-list"></div>

    <h3>Bookmarked Runs</h3>
    <div id="bookmarks-list"></div>
  </aside>

  <main class="main">

    <div class="panel" id="input-panel">
      <h2>Inputs</h2>

      <div class="form-row">
        <div>
          <label for="tier">Tier</label>
          <select id="tier">
            <option value="free" selected>free</option>
            <option value="paid_47">paid_47</option>
            <option value="paid_297">paid_297</option>
          </select>
        </div>
        <div>
          <label for="contact-name">Contact name</label>
          <input type="text" id="contact-name" placeholder="Test Owner" value="Test Owner">
        </div>
        <div>
          <label for="contact-email">Email (optional — used only for ID lookup, no writeback)</label>
          <input type="email" id="contact-email" placeholder="test@example.com">
        </div>
      </div>

      <div>
        <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
          <label for="answers" style="margin-bottom:0;">Business info</label>
          <div class="mode-tabs" role="tablist" style="display:inline-flex;gap:4px;font-size:11px;">
            <button type="button" class="mode-btn active" data-mode="story" onclick="setInputMode('story')">📖 Story</button>
            <button type="button" class="mode-btn" data-mode="guided" onclick="setInputMode('guided')">📝 Guided</button>
            <button type="button" class="mode-btn" data-mode="qa" onclick="setInputMode('qa')">📋 Q&amp;A</button>
          </div>
        </div>
        <textarea id="answers" rows="10" data-mode="story" placeholder="Describe the business in your own words. Cover revenue, biggest challenges, debt picture, taxes, AR aging, financial visibility, growth plans — anything that gives Solomon a real picture. Example:&#10;&#10;A $2.5M B2B agency, mostly retainer work. Cash flow is the constant headache — invoices go out on net-30 but most clients pay closer to net-45 so we're always one slow month away from payroll stress. Carrying about $150K in a working capital line plus some equipment debt. Taxes filed but we're 60 days behind on payroll deposits — Miguel knows about this. No real budget — I look at the bank account to decide what to pay each Friday."></textarea>
        <div id="guided-fields" style="display:none; max-height:600px; overflow-y:auto; border:1px solid #e5e7eb; border-radius:6px; padding:12px; background:#fafafa;"></div>
        <div id="mode-hint" style="font-size:11px;color:#9ca3af;margin-top:4px;">
          📖 Story mode: describe the business in prose. Solomon extracts signals from the narrative.
        </div>
      </div>

      <details>
        <summary>▸ Rubric override (advanced) — edit the system prompt for this run only</summary>
        <div style="margin-top: 8px;">
          <textarea id="rubric-override" rows="14" class="code" placeholder="Leave empty to use the deployed default rubric. Paste a modified version here to test it for this run only — won't affect production."></textarea>
          <div class="sidebar-actions" style="margin-top: 8px;">
            <button onclick="loadDefaultRubric()">Load default rubric →</button>
            <button onclick="saveCurrentRubric()">Save this rubric</button>
          </div>
        </div>
      </details>

      <div class="run-button-row">
        <button class="primary" id="run-btn" onclick="runSolomon()">Run ▶</button>
        <span class="run-status" id="run-status"></span>
      </div>
    </div>

    <div id="output-area">
      <div class="panel">
        <div class="empty-state">No runs yet. Fill in the form above and click <strong>Run</strong>.</div>
      </div>
    </div>

  </main>
</div>

<div class="gate" id="gate">
  <div class="gate-card">
    <h1>🔑 Ask Solomon</h1>
    <p>Internal training console. Enter the team password to continue.</p>
    <input type="password" id="gate-password" placeholder="Password" onkeydown="if(event.key==='Enter')checkPassword()">
    <button class="primary" style="width: 100%;" onclick="checkPassword()">Unlock</button>
    <div class="error" id="gate-error" style="display:none;"></div>
  </div>
</div>

<script>
const PASSWORD_KEY = "asksolomon_password";
const HISTORY_KEY = "asksolomon_history";
const SAVED_RUBRICS_KEY = "asksolomon_saved_rubrics";
const BOOKMARKS_KEY = "asksolomon_bookmarks";
const HISTORY_LIMIT = 20;

// ---------- Auth gate ----------
function checkPassword() {
  const pw = document.getElementById("gate-password").value;
  if (!pw) return showGateError("Enter the password.");
  fetch("/asksolomon/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-console-password": pw },
    body: JSON.stringify({ probe: true })
  }).then(r => {
    if (r.status === 401) return showGateError("Wrong password.");
    if (r.ok || r.status === 400) {
      sessionStorage.setItem(PASSWORD_KEY, pw);
      document.getElementById("gate").style.display = "none";
      renderSidebar();
    } else {
      showGateError("Server error " + r.status);
    }
  }).catch(e => showGateError("Network error: " + e.message));
}
function showGateError(msg) {
  const el = document.getElementById("gate-error");
  el.textContent = msg; el.style.display = "block";
}
function logout() {
  sessionStorage.removeItem(PASSWORD_KEY);
  location.reload();
}
function getPassword() { return sessionStorage.getItem(PASSWORD_KEY) || ""; }

// On load: skip gate if password already in session
window.addEventListener("DOMContentLoaded", () => {
  if (getPassword()) {
    document.getElementById("gate").style.display = "none";
  }
  renderSidebar();
});

// ---------- Storage helpers ----------
function readJson(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function readSession(key, fallback) {
  try { return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}
function readLocal(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
  catch { return fallback; }
}

// ---------- Run ----------
async function runSolomon() {
  const tier = document.getElementById("tier").value;
  const contactName = document.getElementById("contact-name").value.trim();
  const contactEmail = document.getElementById("contact-email").value.trim();
  const answersRaw = document.getElementById("answers").value.trim();
  const rubricOverride = document.getElementById("rubric-override").value.trim();

  const mode = document.getElementById("answers").dataset.mode || "story";
  let answers;

  if (mode === "guided") {
    answers = collectGuidedAnswers();
    if (!answers.length) return toast("Fill in at least one guided question.", "error");
  } else if (!answersRaw) {
    return toast("Add some business info first.", "error");
  } else if (mode === "story") {
    // Story mode: pass the whole narrative as one rich answer.
    // The rubric already instructs Solomon to extract signals from prose.
    answers = [{
      question: "Tell me about this business — situation, revenue, biggest challenges, debt picture, taxes, AR aging, financial visibility, growth plans, what's working and what isn't",
      answer: answersRaw,
    }];
  } else {
    // Q&A mode: accept either "Question? answer" or "Question: answer" per line.
    answers = answersRaw.split(/\\n+/).map(line => {
      const m = line.match(/^(.+?[?:])\\s+(.+)$/);
      if (!m) {
        const idx = line.indexOf(":");
        if (idx === -1) return { question: line.trim(), answer: "" };
        return { question: line.slice(0, idx).trim(), answer: line.slice(idx + 1).trim() };
      }
      return { question: m[1].trim(), answer: m[2].trim() };
    }).filter(a => a.question && a.answer);
    if (!answers.length) return toast("Couldn't parse. Use one per line: 'Annual revenue? $2.5M' or 'Annual revenue: $2.5M'", "error");
  }

  const runBtn = document.getElementById("run-btn");
  const status = document.getElementById("run-status");
  runBtn.disabled = true; status.textContent = "Running…";

  try {
    const res = await fetch("/asksolomon/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-console-password": getPassword() },
      body: JSON.stringify({
        tier,
        contact: { name: contactName, email: contactEmail },
        answers,
        rubricOverride: rubricOverride || undefined,
      }),
    });

    if (res.status === 401) {
      sessionStorage.removeItem(PASSWORD_KEY);
      return location.reload();
    }

    const data = await res.json();
    if (!data.success) throw new Error(data.error || "Unknown error");

    const run = {
      id: "run_" + Date.now(),
      ts: new Date().toISOString(),
      tier,
      contact: { name: contactName, email: contactEmail },
      answersRaw,
      rubricOverride: rubricOverride || null,
      result: data,
    };
    saveRun(run);
    renderOutput(run);
    status.textContent = "✓ Done";
    setTimeout(() => status.textContent = "", 3000);
  } catch (e) {
    toast("Error: " + e.message, "error");
    status.textContent = "✗ Failed";
  } finally {
    runBtn.disabled = false;
  }
}

function saveRun(run) {
  const history = readSession(HISTORY_KEY, []);
  history.unshift(run);
  if (history.length > HISTORY_LIMIT) history.length = HISTORY_LIMIT;
  sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  renderSidebar();
}

// ---------- Render output ----------
function renderOutput(run) {
  const r = run.result;
  const path = r.path || "unknown";
  const badgeClass = "badge " + path;
  const flags = (r.opportunityFlags || []).map(f => '<span class="flag-tag">' + escapeHtml(f) + '</span>').join("") || '<span style="color:#9ca3af;font-size:12px;">none</span>';

  document.getElementById("output-area").innerHTML = \`
    <div class="panel">
      <h2>Output — \${escapeHtml(run.tier)} · \${escapeHtml(new Date(run.ts).toLocaleTimeString())}</h2>
      <div style="margin-bottom: 16px;">
        <span class="\${badgeClass}">PATH: \${escapeHtml(path)}</span>
        <span style="margin-left: 8px; font-size: 12px; color: #6b7280;">Flags:</span> \${flags}
        <button style="float:right;font-size:11px;" onclick="bookmarkRun('\${run.id}')">⭐ Bookmark this run</button>
      </div>
      <div class="output-grid">
        <div class="output-card">
          <h3>✉️ Email Blurb (\${(r.opener || "").length} chars)</h3>
          <div class="email-blurb">\${escapeHtml(r.opener || "(empty)")}</div>
        </div>
        <div class="output-card">
          <h3>🎯 Strategist Brief — INTERNAL (\${(r.strategistBrief || "").length} chars)</h3>
          <div class="strategist-brief">\${escapeHtml(r.strategistBrief || "(empty)")}</div>
        </div>
      </div>
      <div class="output-card" style="margin-bottom:12px;">
        <h3>📄 Report (rendered preview)</h3>
        <div class="report-preview">\${r.reportHtml || "(empty)"}</div>
      </div>
      <div class="output-card">
        <h3>Raw response JSON</h3>
        <textarea rows="10" class="code" readonly>\${escapeHtml(JSON.stringify(r, null, 2))}</textarea>
      </div>
    </div>
  \`;
}

// ---------- Sidebar ----------
function renderSidebar() {
  const history = readSession(HISTORY_KEY, []);
  document.getElementById("history-list").innerHTML = history.length === 0
    ? '<div class="sidebar-empty">No runs yet</div>'
    : history.map(run => {
        const path = run.result?.path || "—";
        const time = new Date(run.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return \`<div class="sidebar-entry" onclick='loadRun("\${run.id}")'>
          <div>\${escapeHtml(run.tier)} · \${escapeHtml(path)}</div>
          <div class="meta">\${escapeHtml(time)} · \${(run.result?.opener || "").length} char blurb</div>
        </div>\`;
      }).join("");

  const saved = readLocal(SAVED_RUBRICS_KEY, []);
  document.getElementById("saved-rubrics-list").innerHTML = saved.length === 0
    ? '<div class="sidebar-empty">No saved rubrics</div>'
    : saved.map((s, i) => \`<div class="sidebar-entry" onclick='loadRubric(\${i})'>
        <div>\${escapeHtml(s.label || "Untitled")}</div>
        <div class="meta">\${escapeHtml(new Date(s.ts).toLocaleDateString())} · \${s.text.length} chars</div>
      </div>\`).join("");

  const bookmarks = readLocal(BOOKMARKS_KEY, []);
  document.getElementById("bookmarks-list").innerHTML = bookmarks.length === 0
    ? '<div class="sidebar-empty">No bookmarks</div>'
    : bookmarks.map(b => \`<div class="sidebar-entry" onclick='loadBookmark("\${b.id}")'>
        <div>\${escapeHtml(b.label || b.tier)} · \${escapeHtml(b.result?.path || "—")}</div>
        <div class="meta">\${escapeHtml(new Date(b.ts).toLocaleDateString())}</div>
      </div>\`).join("");
}

function loadRun(id) {
  const history = readSession(HISTORY_KEY, []);
  const run = history.find(r => r.id === id);
  if (run) renderOutput(run);
}
function loadBookmark(id) {
  const bookmarks = readLocal(BOOKMARKS_KEY, []);
  const run = bookmarks.find(r => r.id === id);
  if (run) renderOutput(run);
}
function bookmarkRun(id) {
  const history = readSession(HISTORY_KEY, []);
  const run = history.find(r => r.id === id);
  if (!run) return toast("Couldn't find that run.", "error");
  const label = prompt("Label this bookmark:", run.tier + " · " + run.result.path);
  if (label === null) return;
  const bookmarks = readLocal(BOOKMARKS_KEY, []);
  bookmarks.unshift({ ...run, label });
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  toast("Bookmarked.", "success"); renderSidebar();
}
function clearHistory() {
  if (!confirm("Clear all session history? Bookmarks and saved rubrics will stay.")) return;
  sessionStorage.removeItem(HISTORY_KEY); renderSidebar();
}

// ---------- Rubric ----------
async function loadDefaultRubric() {
  try {
    const res = await fetch("/asksolomon/rubric", { headers: { "x-console-password": getPassword() } });
    if (res.status === 401) { sessionStorage.removeItem(PASSWORD_KEY); return location.reload(); }
    const data = await res.json();
    document.getElementById("rubric-override").value = data.rubric || "";
    toast("Loaded default rubric. Edit and Run to test variants.", "success");
  } catch (e) { toast("Couldn't load rubric: " + e.message, "error"); }
}
function saveCurrentRubric() {
  const text = document.getElementById("rubric-override").value.trim();
  if (!text) return toast("Rubric override is empty — nothing to save.", "error");
  const label = prompt("Name this rubric variant:");
  if (!label) return;
  const saved = readLocal(SAVED_RUBRICS_KEY, []);
  saved.unshift({ label, text, ts: new Date().toISOString() });
  localStorage.setItem(SAVED_RUBRICS_KEY, JSON.stringify(saved));
  toast("Saved.", "success"); renderSidebar();
}
function loadRubric(idx) {
  const saved = readLocal(SAVED_RUBRICS_KEY, []);
  const s = saved[idx]; if (!s) return;
  document.getElementById("rubric-override").value = s.text;
  document.querySelector("#input-panel details").open = true;
  toast("Loaded: " + s.label, "success");
}

// ---------- Export / Import learnings ----------
function exportLearnings() {
  const data = {
    exportedAt: new Date().toISOString(),
    savedRubrics: readLocal(SAVED_RUBRICS_KEY, []),
    bookmarks: readLocal(BOOKMARKS_KEY, []),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "asksolomon-learnings-" + new Date().toISOString().slice(0,10) + ".json"; a.click();
  URL.revokeObjectURL(url);
  toast("Exported.", "success");
}
function importLearnings() {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json";
  input.onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.savedRubrics) localStorage.setItem(SAVED_RUBRICS_KEY, JSON.stringify([...(data.savedRubrics || []), ...readLocal(SAVED_RUBRICS_KEY, [])]));
      if (data.bookmarks) localStorage.setItem(BOOKMARKS_KEY, JSON.stringify([...(data.bookmarks || []), ...readLocal(BOOKMARKS_KEY, [])]));
      toast("Imported. Merged with existing.", "success"); renderSidebar();
    } catch (e) { toast("Invalid file: " + e.message, "error"); }
  };
  input.click();
}

// ---------- Input mode (Story / Guided / Q&A) ----------
const MODE_CONFIG = {
  story: {
    label: "Business info",
    hint: "📖 Story mode: describe the business in prose. Solomon extracts signals from the narrative.",
    placeholder: "Describe the business in your own words. Cover revenue, biggest challenges, debt picture, taxes, AR aging, financial visibility, growth plans — anything that gives Solomon a real picture. Example:\\n\\nA $2.5M B2B agency, mostly retainer work. Cash flow is the constant headache — invoices go out on net-30 but most clients pay closer to net-45 so we're always one slow month away from payroll stress. Carrying about $150K in a working capital line plus some equipment debt. Taxes filed but we're 60 days behind on payroll deposits — Miguel knows about this. No real budget — I look at the bank account to decide what to pay each Friday.",
  },
  guided: {
    label: "Guided intake — tier-specific questions",
    hint: "📝 Guided mode: questions from the canonical SWOT intake (Miguel's voice). Skip any that don't apply. Switch tier above to see different question sets.",
  },
  qa: {
    label: "Answers (one per line)",
    hint: "📋 Q&A mode: 'Question? answer' or 'Question: answer' per line.",
    placeholder: "Annual revenue? $2.5M\\nBiggest challenge? Cash flow timing\\nActive debt? Yes — $150K in working capital lines\\nRecent financial audit? No, never had one",
  },
};

// ---------- Tier question sets (canonical SWOT intake from SWOT_Questions_v3_MiguelVoice.md) ----------
const FREE_QUESTIONS = [
  { key: "P1", text: "What best describes your business type?", hint: "Service-based / Product-based / Hybrid" },
  { key: "P2", text: "How do you primarily reach your customers?", hint: "Local presence / Statewide / Regional multi-state / National / E-commerce" },
  { key: "P3", text: "What industry or vertical best describes your business?" },
  { key: "Q1", text: "Do you currently have any active judgments, tax liens, or corporate debt you're actively managing?", hint: "Yes / No / Not sure" },
  { key: "Q2", text: "When you make business decisions, are you basing them on your actual numbers — or on what's in your bank account?", hint: "[Miguel's 'magic question'] Real numbers / bank balance / in between / not sure" },
  { key: "Q3", text: "What does your business consistently deliver that your clients say they can't get anywhere else?" },
  { key: "Q4", text: "When a client refers you, what specific words or outcome do they use to describe what you did for them?" },
  { key: "Q5", text: "Where does revenue most often leak in your business — proposals that don't close, work that goes over budget, clients that churn, or invoices that don't get paid on time?" },
  { key: "Q6", text: "What would change in your business if you had 20% more profit on the same revenue — and where do you think that 20% is hiding?" },
  { key: "Q7", text: "Where do you see demand in your market that you're not yet positioned to capture?" },
  { key: "Q8", text: "What would happen to your business if your single largest client, revenue source, or referral channel disappeared in the next 90 days?" },
];
const PAID_47_ADDITIONAL = [
  { key: "Q9", text: "What is the total balance of your current corporate debt — across all loans, lines of credit, and outstanding obligations?", hint: "Approximate amount or range" },
  { key: "Q10", text: "How much do you pay every month on servicing your corporate debt — your total monthly debt service?", hint: "Approximate monthly amount" },
  { key: "Q11", text: "What is the status of your current corporate debt?", hint: "Current and well-managed / current but stretched / managing actively / active judgments or tax liens involved" },
  { key: "Q12", text: "How much of your accounts receivable is currently 30+ days overdue?", hint: "[30 days is normal] Approximate amount or range" },
  { key: "Q13", text: "How much is 60+ days overdue?", hint: "[60+ is when it becomes a problem]" },
  { key: "Q14", text: "What is the status of your business tax returns for the last two years — are they filed and current?", hint: "Filed and current / filed with outstanding balance or plan / one or both not yet filed / working with an accountant" },
  { key: "Q15", text: "When did you last review what you're paying for merchant processing — and whether you're getting real value and proper coverage for the cost?", hint: "Within 12 months / 1-3 years / never / don't know what I'm paying" },
  { key: "Q16", text: "Have you ever had a formal financial audit, review, or deep dive conducted on your business?", hint: "Yes within 2 years / yes more than 2 years ago / never / in progress" },
  { key: "Q17", text: "Do you currently have a documented financial plan or budget for this year?", hint: "Yes track actuals / yes but don't use it / no formal budget" },
  { key: "Q18", text: "Which financial metrics are you not currently tracking that you suspect you should be?", hint: "Margin by line / CAC / LTV / close rate / AR aging / debt service vs net revenue / other" },
  { key: "Q19", text: "Which of your products, services, or client segments produces your best margins — and do you actually know why?" },
  { key: "Q20", text: "What proprietary process, methodology, or capability do you have that a competitor would struggle to replicate?" },
  { key: "Q21", text: "What recurring revenue, retainer, or continuity offer could you realistically add to your current client base in the next 90 days?" },
  { key: "Q22", text: "What bold move in the next 12-24 months could 2-3x the business — and what is specifically stopping you from starting it?" },
  { key: "Q23", text: "Which automations, financial tools, or AI workflows could free up real capacity or cut real costs for your team this quarter?" },
  { key: "Q24", text: "Who are your top 2-3 competitors right now, and what are they doing that you'd rather they weren't?" },
  { key: "Q25", text: "Where are you losing deals — and what reason do prospects give when they choose someone else over you?" },
  { key: "Q26", text: "How visible is your business compared to your top competitors in search, reviews, referrals, and social? Where are you winning attention, and where are you effectively invisible?" },
];
const PAID_297_ADDITIONAL = [
  { key: "Q_A", text: "Walk through your top 3 client engagements or revenue wins in the last 12 months — what was the revenue, the margin, and what made each one work?" },
  { key: "Q_B", text: "What are your gross and net margins by product, service line, or client segment? Which is your most profitable, and which is costing you the most to deliver?" },
  { key: "Q_C", text: "How do your unit economics compare to what you believe is the benchmark for your industry — CAC, LTV, payback period, gross margin?" },
  { key: "Q_D", text: "What is your current cash position and runway — and how would three consecutive months of below-average revenue impact the business?" },
  { key: "Q_E", text: "Walk us through your current debt stack: total corporate debt, monthly debt service, and how comfortable you are with that level of leverage right now." },
  { key: "Q_F", text: "What does your accounts receivable aging look like in detail — total AR, amount 30+ days overdue, and amount 60+ days overdue?" },
  { key: "Q_G", text: "What is your close rate at each stage of your sales process — lead to qualified, qualified to proposal, proposal to closed — and where does it leak the most?" },
  { key: "Q_H", text: "What is the single biggest 'we should have fixed this years ago' problem still on your list — and what has kept it there?" },
  { key: "Q_I", text: "If you had to cut 20% of your services, clients, or overhead tomorrow, what would go first — and why hasn't it gone already?" },
  { key: "Q_J", text: "What percentage of your revenue comes from your top 10% of clients — and what is your realistic exposure if any of them left in the next 6 months?" },
  { key: "Q_K", text: "What regulatory, tax, compliance, or technology changes on the horizon could materially impact how your business operates or gets paid?" },
  { key: "Q_L", text: "What geographic or vertical expansion has the lowest barrier to entry based on what you already do today — and what would it take to move on it?" },
  { key: "Q_M", text: "What does success look like for your business three years from now — and what is the single biggest financial or operational obstacle standing between you and that picture today?" },
];
function questionsForTier(tier) {
  if (tier === "paid_297") return [...FREE_QUESTIONS, ...PAID_47_ADDITIONAL, ...PAID_297_ADDITIONAL];
  if (tier === "paid_47")  return [...FREE_QUESTIONS, ...PAID_47_ADDITIONAL];
  return FREE_QUESTIONS;
}

function renderGuidedFields(tier) {
  const container = document.getElementById("guided-fields");
  if (!container) return;
  const questions = questionsForTier(tier);
  const count = { free: FREE_QUESTIONS.length, paid_47: FREE_QUESTIONS.length + PAID_47_ADDITIONAL.length, paid_297: FREE_QUESTIONS.length + PAID_47_ADDITIONAL.length + PAID_297_ADDITIONAL.length }[tier] || FREE_QUESTIONS.length;
  container.innerHTML =
    '<div style="font-size:11px;color:#6b7280;margin-bottom:10px;padding:6px 8px;background:#fef3c7;border-radius:4px;">'
    + '<strong>' + escapeHtml(tier.toUpperCase()) + '</strong> tier · ' + count + ' questions · skip any that don\\'t apply'
    + '</div>'
    + questions.map(q => {
        const id = "gq_" + q.key;
        const hint = q.hint ? '<div style="font-size:10px;color:#9ca3af;margin-top:2px;">' + escapeHtml(q.hint) + '</div>' : "";
        return '<div style="margin-bottom:12px;">'
          + '<label for="' + id + '" style="font-size:12px;color:#374151;font-weight:500;display:block;margin-bottom:2px;">'
          + '<span style="font-family:ui-monospace,monospace;font-size:10px;color:#92400e;margin-right:6px;">' + escapeHtml(q.key) + '</span>'
          + escapeHtml(q.text)
          + '</label>'
          + hint
          + '<textarea id="' + id + '" data-question="' + escapeHtml(q.text) + '" rows="2" style="width:100%;margin-top:4px;padding:6px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:12px;font-family:inherit;" placeholder="(skip if not applicable)"></textarea>'
          + '</div>';
      }).join("");
}

function collectGuidedAnswers() {
  const container = document.getElementById("guided-fields");
  if (!container) return [];
  return Array.from(container.querySelectorAll("textarea")).map(ta => ({
    question: ta.dataset.question || "",
    answer: ta.value.trim(),
  })).filter(a => a.question && a.answer);
}

function setInputMode(mode) {
  const cfg = MODE_CONFIG[mode] || MODE_CONFIG.story;
  document.querySelectorAll(".mode-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.mode === mode);
  });
  const ta = document.getElementById("answers");
  const guided = document.getElementById("guided-fields");
  ta.dataset.mode = mode;

  if (mode === "guided") {
    ta.style.display = "none";
    guided.style.display = "block";
    const tier = document.getElementById("tier").value;
    renderGuidedFields(tier);
  } else {
    ta.style.display = "";
    guided.style.display = "none";
    if (cfg.placeholder) ta.placeholder = cfg.placeholder;
  }

  const labelEl = document.querySelector('label[for="answers"]');
  if (labelEl) labelEl.textContent = cfg.label;
  const hintEl = document.getElementById("mode-hint");
  if (hintEl) hintEl.textContent = cfg.hint;
}

// Re-render guided fields when tier changes (only if in guided mode).
window.addEventListener("DOMContentLoaded", () => {
  const tierEl = document.getElementById("tier");
  if (tierEl) {
    tierEl.addEventListener("change", () => {
      const ta = document.getElementById("answers");
      if (ta && ta.dataset.mode === "guided") {
        renderGuidedFields(tierEl.value);
      }
    });
  }
});

// ---------- Helpers ----------
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]));
}
function toast(msg, kind) {
  const t = document.createElement("div");
  t.className = "toast " + (kind || "");
  t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
</script>

</body>
</html>`;
