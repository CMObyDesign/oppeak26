/* CFO By Design — HighLevel funnel footer injector.
 *
 * Loaded on every HL funnel page via a <script defer src="…/footer.js"> in
 * the funnel header tracking code. Appends a consistent legal footer and
 * marks the body so funnel-page.css can style the whole wrapper.
 *
 * Renders once — safe to include on pages that already have the footer.
 * Silent no-op if the DOM isn't available (e.g., SSR / crawler bots).
 */
(function () {
  if (typeof document === "undefined" || !document.body) return;

  var BODY_CLASS = "cfobd-funnel";
  var FOOTER_CLASS = "cfobd-footer";
  var LOGO_URL = "https://assets.cdn.filesafe.space/oLIENQCtGnt9U6gfLhE5/media/6a57c2731097b811951d0e7d.png";
  var SITE_URL = "https://www.cfobydesign.com";
  var PRIVACY_URL = "https://www.cfobydesign.com/privacy";
  var TERMS_URL = "https://www.cfobydesign.com/tos";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function render() {
    // Mark the body so funnel-page.css takes effect wrapper-wide.
    document.body.classList.add(BODY_CLASS);

    // Never render twice on the same page.
    if (document.querySelector("." + FOOTER_CLASS)) return;

    var footer = document.createElement("footer");
    footer.className = FOOTER_CLASS;
    footer.setAttribute("role", "contentinfo");
    footer.innerHTML =
      '<div class="cfobd-footer__brand">' +
        '<img class="cfobd-footer__logo" src="' + LOGO_URL + '" alt="CFO By Design" />' +
        '<div class="cfobd-footer__brand-text">' +
          '<p class="cfobd-footer__line1">' +
            'CFO By Design | ' +
            '<a href="' + SITE_URL + '" target="_blank" rel="noopener noreferrer">cfobydesign.com</a>' +
            ' | Confidential' +
          '</p>' +
          '<p class="cfobd-footer__tagline">Your Business Finances. Professionally Managed.</p>' +
        '</div>' +
      '</div>' +
      '<div class="cfobd-footer__legal">' +
        '<a href="' + PRIVACY_URL + '" target="_blank" rel="noopener noreferrer">Privacy</a>' +
        '<a href="' + TERMS_URL + '" target="_blank" rel="noopener noreferrer">Terms</a>' +
      '</div>';

    document.body.appendChild(footer);
  }

  ready(render);
})();
