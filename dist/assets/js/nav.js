/* ==========================================================================
   nav.js — mobile navigation toggle. Ships on every page (dev and built),
   so the menu works in the static build where includes.js is removed.
   ========================================================================== */
(function () {
  "use strict";
  function wire() {
    var toggle = document.querySelector(".nav-toggle");
    var nav = document.querySelector(".site-nav");
    if (!toggle || !nav || toggle.dataset.wired) return;
    toggle.dataset.wired = "true";
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
  // Re-run after client-side includes resolve (dev workflow).
  document.addEventListener("includes:loaded", wire);
})();
