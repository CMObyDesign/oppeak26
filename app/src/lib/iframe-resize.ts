// Iframe auto-resize bridge.
//
// When embedded in an iframe on a funnel page (e.g. success.cfobydesign.com),
// this posts the page's true content height to the parent so the parent can
// resize the iframe to match. Result: no inner iframe scrollbar — the parent
// page scrolls the whole thing as one scroll region.
//
// Pairs with a matching `window.addEventListener("message", ...)` snippet on
// the GHL funnel page (see README/docs for the paste-in HTML).
//
// Safe when NOT embedded: no-ops when window.self === window.top.

const MESSAGE_TYPE = "cfobd-iframe-height";

function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access threw, which itself means we're embedded.
    return true;
  }
}

function measureAndPost(): void {
  // Use scrollHeight of the documentElement — the tallest of margin box,
  // padding edges, and children. Works for absolutely-positioned children
  // and dynamic content alike.
  const el = document.documentElement;
  const height = Math.max(
    el.scrollHeight,
    el.offsetHeight,
    document.body.scrollHeight,
    document.body.offsetHeight,
  );
  window.parent.postMessage({ type: MESSAGE_TYPE, height }, "*");
}

let scheduled = false;
function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    measureAndPost();
  });
}

export function initIframeResize(): void {
  if (!isEmbedded()) return;

  // Prevent our own body from ever scrolling — the parent iframe now owns
  // scrolling. Belt on top of the `scrolling="no"` suspenders on the iframe.
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";

  // Initial measure once fonts + images have had a chance to settle.
  schedule();
  window.addEventListener("load", schedule);

  // Resize / orientation / DPR changes.
  window.addEventListener("resize", schedule);

  // Any DOM change (screen transitions, dropdown open, error message appears).
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  // Any element that resizes (images loading, framer-motion animations,
  // long text wrapping differently after webfonts land).
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(schedule);
    ro.observe(document.body);
  }

  // Fallback: images that load after mount don't always fire a mutation
  // — a slow polling pass for the first few seconds catches them.
  let pollCount = 0;
  const pollId = window.setInterval(() => {
    schedule();
    pollCount += 1;
    if (pollCount >= 20) window.clearInterval(pollId); // ~10s
  }, 500);
}
