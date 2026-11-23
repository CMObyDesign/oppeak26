// Streamed Claude calls for the BGA Copilot's long outputs (roadmap draft, prep brief).
//
// A single-response request that generates for more than ~100 seconds hits Cloudflare's upstream
// timeout and comes back as a 524 (see the paid_47 note in index.js, Oct 28, 2026). With
// `stream: true` Anthropic starts sending events within seconds and each one keeps the connection
// alive, so a two- or three-minute draft arrives whole. The caller gets the same shape as before:
// { ok, text, stop_reason } or { ok: false, error }.
//
// A plain JSON body (test stubs, or an API that ignored `stream`) is accepted too.

export async function callClaudeStreamed({ env, body, fetchImpl = fetch }) {
  let res;
  try {
    res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": env.ANTHROPIC_VERSION || "2023-06-01",
        accept: "text/event-stream",
      },
      body: JSON.stringify({ ...body, stream: true }),
    });
  } catch (err) {
    return { ok: false, error: `Claude fetch failed: ${err?.message || err}` };
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, error: `Claude API ${res.status}: ${detail.slice(0, 300)}` };
  }
  const { text, stopReason } = await readClaudeResponse(res);
  if (!text) return { ok: false, error: "Claude response had no text" };
  return { ok: true, text, stop_reason: stopReason };
}

export async function readClaudeResponse(response) {
  let raw = "";
  let text = "";
  let stopReason = null;
  const take = (chunk) => {
    for (const rawLine of chunk.split("\n")) {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") text += String(ev.delta.text || "");
      else if (ev.type === "message_delta" && ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
    }
  };
  if (response.body && typeof response.body.getReader === "function") {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        raw += tail;
        buffer += tail;
        take(buffer);
        break;
      }
      const piece = decoder.decode(value, { stream: true });
      raw += piece;
      buffer += piece;
      const cut = buffer.lastIndexOf("\n");
      if (cut === -1) continue;
      take(buffer.slice(0, cut + 1));
      buffer = buffer.slice(cut + 1);
    }
  } else {
    raw = await response.text();
    take(raw);
  }
  // Not a stream: a single JSON Messages response.
  if (!text && raw.trim().startsWith("{")) {
    try {
      const data = JSON.parse(raw);
      text = (data?.content || []).filter((c) => c && typeof c.text === "string" && (!c.type || c.type === "text")).map((c) => c.text).join("");
      stopReason = data?.stop_reason || null;
    } catch { /* leave empty */ }
  }
  return { text, stopReason };
}
