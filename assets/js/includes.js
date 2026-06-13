/* ==========================================================================
   includes.js — lightweight HTML partial loader
   Usage: <div data-include="assets/partials/header.html"></div>
   Works over http(s). When opened directly from file:// some browsers block
   fetch of local files; in that case the partial simply won't load, so each
   page also ships a <noscript>-free static fallback note in the README.
   For production, prefer a real build step (see README) — this keeps the
   source DRY during development and on any static host.
   ========================================================================== */
(function () {
  "use strict";

  function setActiveNav(root) {
    // Mark the current page in the nav using the body's data-page attribute.
    var page = document.body.getAttribute("data-page");
    if (!page) return;
    var link = root.querySelector('[data-nav="' + page + '"]');
    if (link) link.setAttribute("aria-current", "page");
  }

  function wireMobileNav(root) {
    var toggle = root.querySelector(".nav-toggle");
    var nav = root.querySelector(".site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      var open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  function loadIncludes() {
    var nodes = document.querySelectorAll("[data-include]");
    var pending = nodes.length;
    if (!pending) return;

    nodes.forEach(function (node) {
      var url = node.getAttribute("data-include");
      fetch(url)
        .then(function (res) {
          if (!res.ok) throw new Error(res.status);
          return res.text();
        })
        .then(function (html) {
          node.outerHTML = html;
        })
        .catch(function () {
          // Leave the node as-is on failure (file:// or missing partial).
          node.setAttribute("data-include-failed", "true");
        })
        .finally(function () {
          pending -= 1;
          if (pending === 0) {
            setActiveNav(document);
            wireMobileNav(document);
            document.dispatchEvent(new CustomEvent("includes:loaded"));
          }
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadIncludes);
  } else {
    loadIncludes();
  }
})();
