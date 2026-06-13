/* ==========================================================================
   tabs.js — accessible tabs (WAI-ARIA Tabs pattern)
   Markup:
     <div class="tabs" data-tabs>
       <div role="tablist" aria-label="...">
         <button role="tab" id="tab-x" aria-controls="panel-x">X</button> ...
       </div>
       <div role="tabpanel" id="panel-x" aria-labelledby="tab-x">...</div> ...
     </div>
   Supports left/right/home/end keys and #panel-id deep links.
   ========================================================================== */
(function () {
  "use strict";

  function initTabset(tabset) {
    var tabs = Array.prototype.slice.call(tabset.querySelectorAll('[role="tab"]'));
    var panels = Array.prototype.slice.call(tabset.querySelectorAll('[role="tabpanel"]'));
    if (!tabs.length) return;

    function select(index, setFocus) {
      tabs.forEach(function (tab, i) {
        var selected = i === index;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && setFocus) tab.focus();
      });
      panels.forEach(function (panel, i) {
        panel.hidden = i !== index;
      });
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { select(i, false); });
      tab.addEventListener("keydown", function (e) {
        var idx = null;
        if (e.key === "ArrowRight") idx = (i + 1) % tabs.length;
        else if (e.key === "ArrowLeft") idx = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === "Home") idx = 0;
        else if (e.key === "End") idx = tabs.length - 1;
        if (idx !== null) { e.preventDefault(); select(idx, true); }
      });
    });

    // Deep link: if the URL hash matches a panel, open its tab.
    var start = 0;
    if (window.location.hash) {
      var hash = window.location.hash.slice(1);
      panels.forEach(function (panel, i) {
        if (panel.id === hash) start = i;
      });
    }
    select(start, false);
  }

  function initAll() {
    document.querySelectorAll("[data-tabs]").forEach(initTabset);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll);
  } else {
    initAll();
  }
})();
