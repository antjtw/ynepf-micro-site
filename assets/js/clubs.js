/* ==========================================================================
   clubs.js — render the approved clubs list from window.APPROVED_CLUBS_DATA
   (written by scripts/fetch-approved-clubs.js) and filter it as you type.
   ========================================================================== */
(function () {
  "use strict";

  // A club counts as new if the EPA added it, or we first saw it, this recently.
  var NEW_DAYS = 90;

  var data = window.APPROVED_CLUBS_DATA;
  var list = document.getElementById("club-list");
  var search = document.getElementById("club-search");
  var count = document.getElementById("club-count");
  var empty = document.getElementById("clubs-empty");
  if (!data || !list) return;

  var cutoff = Date.now() - NEW_DAYS * 864e5;
  function isNew(club) {
    var dates = [club.addedToEpa, club.firstSeen].filter(Boolean).map(Date.parse);
    return dates.some(function (d) { return d >= cutoff; });
  }

  function formatDate(iso) {
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function initials(name) {
    return name.split(/\s+/).filter(function (w) { return /^[a-z0-9]/i.test(w); })
      .slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join("");
  }

  var clubs = data.clubs.slice().sort(function (a, b) {
    return a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" });
  });

  var items = clubs.map(function (club) {
    var li = el("li", "club");

    var logo = el("div", "club-logo");
    if (club.logo) {
      var img = document.createElement("img");
      img.src = club.logo;
      img.alt = club.name + " logo";
      img.loading = "lazy";
      img.decoding = "async";
      logo.appendChild(img);
    } else {
      logo.classList.add("club-logo-none");
      logo.appendChild(el("span", "club-initials", initials(club.name))).setAttribute("aria-hidden", "true");
      logo.appendChild(el("span", "club-logo-note", "No logo on file"));
    }
    li.appendChild(logo);

    var body = el("div", "club-body");
    var head = el("div", "club-head");
    head.appendChild(el("h2", "club-name", club.name));
    if (isNew(club)) head.appendChild(el("span", "tag tag-open", "New"));
    body.appendChild(head);

    club.description.split(/\n{2,}/).forEach(function (para) {
      body.appendChild(el("p", "club-desc", para));
    });

    if (club.website) {
      var a = el("a", "club-link");
      a.href = club.website;
      a.rel = "noopener";
      a.target = "_blank";
      a.textContent = "Visit website";
      a.appendChild(el("span", "visually-hidden", " for " + club.name + " (opens in a new tab)"));
      body.appendChild(a);
    }
    li.appendChild(body);
    list.appendChild(li);

    return { node: li, text: (club.name + " " + club.description).toLowerCase() };
  });

  function update() {
    var terms = search.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    var shown = 0;
    items.forEach(function (item) {
      var match = terms.every(function (t) { return item.text.indexOf(t) !== -1; });
      item.node.hidden = !match;
      if (match) shown++;
    });
    count.textContent = terms.length
      ? "Showing " + shown + " of " + items.length + " clubs"
      : items.length + " approved clubs";
    empty.hidden = shown !== 0;
  }
  search.addEventListener("input", update);
  update();

  var source = document.getElementById("clubs-source");
  if (source && data.checkedAt) {
    source.appendChild(document.createTextNode(" Last checked " + formatDate(data.checkedAt) + "."));
  }

  if (data.removed && data.removed.length) {
    var removedList = document.getElementById("removed-list");
    data.removed.forEach(function (r) {
      removedList.appendChild(el("li", null, r.name + " (removed " + formatDate(r.removedOn) + ")"));
    });
    document.getElementById("removed-clubs").hidden = false;
  }
})();
