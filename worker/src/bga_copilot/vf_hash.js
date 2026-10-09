// BGA Copilot — verified-financials entries_hash.
//
// The verified-financials panel ships one shared array per contact, and
// pre-5a an interleaved read-modify-write between two overlapping saves
// could silently clobber one of them (Codex P1 on #93, Finding 2).
// This module adds hash-based optimistic concurrency:
//
//   - Reads expose `entries_hash` = sha256(current stored raw).
//   - Writes require `expected_entries_hash`. On mismatch, the server
//     returns 409 and does NOT write; the client refetches and retries.
//
// The hash is derived (not stored) and read from the raw string the
// Worker itself wrote on the previous save, so canonicalization is
// trivially stable: the Worker uses one serializer (JSON.stringify of
// the entries array), so hashing the raw string before deserialization
// is deterministic for any content the server itself has produced.
//
// For externally-written values (e.g. a strategist manually edits the
// field in HL), the hash still works — any byte change invalidates it,
// so the next client write that didn't see that external edit gets 409
// and refetches. That's exactly what we want.

/**
 * SHA-256 of a UTF-8 string, hex-encoded. Returns a Promise<string> of
 * 64 hex characters. The Workers runtime exposes `crypto.subtle`, and
 * Node 22+ does too via `globalThis.crypto`.
 */
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(String(str ?? ""));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  const arr = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < arr.length; i++) {
    out += arr[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Hash of the raw stored swot_verified_financials string. An empty /
 * missing field hashes as the SHA-256 of the empty string
 * (`e3b0c442…`), so the client can distinguish "no entries yet" from
 * "catalog not loaded" and still pin writes to a known-current state.
 *
 * Hashes the string pre-parse. The Worker's own writer uses one
 * serialization path, so this is deterministic for any content it
 * produced; external edits still trip a mismatch and force a refetch,
 * which is the point.
 */
export function hashVerifiedFinancialsRaw(raw) {
  const s = typeof raw === "string" ? raw : "";
  return sha256Hex(s);
}
