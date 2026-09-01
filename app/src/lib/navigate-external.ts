// External navigation helper for payment / booking links.
//
// Default `window.open(url, "_blank")` opens a new browser tab, which breaks
// the funnel flow — the user often thinks the payment didn't happen because
// their original tab still shows the report. Instead, replace the current
// browsing context so the payment page IS the next screen.
//
// When embedded in an iframe (production case, funnel page on
// success.cfobydesign.com), navigating `window.location` would only move
// the iframe, leaving the parent funnel wrapper around it. Top-level
// navigation via `window.top.location` breaks out of the iframe so the
// payment page fills the whole tab. Cross-origin writes to
// `window.top.location.href` are permitted by same-origin policy even
// when the parent frame is on a different origin.
export function navigateExternal(url: string): void {
  if (!url) return;
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.href = url;
      return;
    }
  } catch {
    // Cross-origin exception in some edge case — fall through to same-window nav.
  }
  window.location.href = url;
}
