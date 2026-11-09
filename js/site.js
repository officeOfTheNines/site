// Small helpers used on every page (no Supabase here).
(function () {
  'use strict';

  // Hide the logo image if favicon.png has not been uploaded yet; the text name stays.
  function hideIfBroken(img) {
    if (img.complete && img.naturalWidth === 0) img.hidden = true;
    img.addEventListener('error', function () { img.hidden = true; });
  }
  document.querySelectorAll('img[data-logo]').forEach(hideIfBroken);

  // Called by member pages when supabase-js could not load (offline, blocked CDN...).
  window.NinesPageLoadFailed = function () {
    document.querySelectorAll('[data-state]').forEach(function (node) {
      node.hidden = node.getAttribute('data-state') !== 'error';
    });
    document.body.setAttribute('aria-busy', 'false');
    document.querySelectorAll('[data-action="sign-out"]').forEach(function (b) { b.hidden = true; });
    document.querySelectorAll('[data-slot="error-message"]').forEach(function (node) {
      node.textContent = 'The login system could not load. Check your connection, ' +
        'turn off any content blocker for this site, and reload.';
    });
  };
})();
