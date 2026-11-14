/* ==========================================================================
   site.js — shared helpers for every page that reads from the database.
   Exposes window.YNEPF. Needs (in this order): vendor/supabase.js,
   vendor/marked.min.js, vendor/purify.min.js, config.js
   ========================================================================== */
(function () {
  "use strict";

  // The browser's own replaceChildren() turns a null into the word "null" on the page. We often pass `condition ? thing : null`,
  // so ignore anything that is not a real piece of content.
  if (window.Element && Element.prototype.replaceChildren && !Element.prototype.replaceChildren.__quiet) {
    var nativeReplace = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function () {
      return nativeReplace.apply(this, Array.prototype.filter.call(arguments, function (n) { return n !== null && n !== undefined && n !== false; }));
    };
    Element.prototype.replaceChildren.__quiet = true;
  }

  var TZ = "Europe/London"; // GMT in winter, BST in summer
  var cfg = window.YNEPF_CONFIG || {};
  var client = null;

  function configured() {
    return !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  }

  function db() {
    if (!client && configured()) {
      client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return client;
  }

  // ---- DOM ----------------------------------------------------------------
  // el("div", {class: "x", onclick: fn}, child, "text", ...) -> Element
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === false || v === null || v === undefined) return;
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v; // only ever called with sanitised HTML
        else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(node, c); });
    else node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  function svg(path) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = path;
    return s;
  }
  var ICONS = {
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    pin: '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="2"/>',
    people: '<circle cx="9" cy="8" r="3" stroke="currentColor" stroke-width="2"/><path d="M3 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    chevron: '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    instagram: '<rect x="3" y="3" width="18" height="18" rx="5" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/>'
  };

  // ---- Markdown (always sanitised) -----------------------------------------
  function markdown(md) {
    var html = window.marked.parse(md || "", { gfm: true, breaks: false });
    var tmp = document.createElement("div");
    tmp.innerHTML = window.DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
    Array.prototype.forEach.call(tmp.querySelectorAll("table"), function (t) {
      t.classList.add("data");
      var wrap = document.createElement("div");
      wrap.className = "table-wrap";
      t.parentNode.insertBefore(wrap, t);
      wrap.appendChild(t);
    });
    // Pictures: only ones uploaded through the editor (our own Storage bucket) are allowed, so nobody can
    // slip in an outside image or tracking pixel. They are lazy-loaded, and sized from the file name
    // (<name>-<width>x<height>.webp) so the page does not jump as they arrive.
    var base = ((window.YNEPF_CONFIG || {}).supabaseUrl || "").replace(/\/$/, "");
    var allowed = base ? base + "/storage/v1/object/public/news-images/" : "";
    Array.prototype.forEach.call(tmp.querySelectorAll("img"), function (i) {
      var src = i.getAttribute("src") || "";
      if (!allowed || src.indexOf(allowed) !== 0) { i.remove(); return; }
      if (!i.hasAttribute("alt")) i.setAttribute("alt", "");
      var m = src.match(/-(\d{2,5})x(\d{2,5})\.(?:webp|jpe?g)$/);
      if (m) { i.setAttribute("width", m[1]); i.setAttribute("height", m[2]); }
      i.setAttribute("loading", "lazy");
      i.setAttribute("decoding", "async");
    });
    // A paragraph left empty by a removed picture would only add blank space.
    Array.prototype.forEach.call(tmp.querySelectorAll("p"), function (p) { if (!p.textContent.trim() && !p.querySelector("img")) p.remove(); });
    Array.prototype.forEach.call(tmp.querySelectorAll("a[href]"), function (a) {
      if (/^https?:/i.test(a.getAttribute("href")) && a.hostname !== location.hostname) {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener");
      }
    });
    return tmp;
  }
  // A readable page anchor from a heading: "YNE Worlds" -> "yne-worlds", "Entry & rules" -> "entry-and-rules".
  function anchorSlug(s) {
    return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  }
  // Plain-text excerpt from markdown, for list pages.
  function excerpt(md, max) {
    var t = (md || "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[#>*_`|~-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    max = max || 180;
    return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
  }

  // ---- UK time -------------------------------------------------------------
  function parts(date, opts) {
    var out = {};
    new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: TZ, hourCycle: "h23" }, opts))
      .formatToParts(date).forEach(function (p) { out[p.type] = p.value; });
    return out;
  }
  // Date -> "YYYY-MM-DDTHH:mm" as UK wall-clock time (for <input type=datetime-local>)
  function toLondonInput(iso) {
    if (!iso) return "";
    var p = parts(new Date(iso), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
  }
  // "YYYY-MM-DDTHH:mm" read as UK wall-clock time -> ISO instant (handles GMT/BST)
  function fromLondonInput(local) {
    if (!local) return null;
    var m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!m) return null;
    var asUTC = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    var guess = asUTC;
    for (var i = 0; i < 3; i++) {
      var p = parts(new Date(guess), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      var shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
      guess += asUTC - shown;
    }
    return new Date(guess).toISOString();
  }
  function todayLondon() {
    var p = parts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    return p.year + "-" + p.month + "-" + p.day;
  }
  function addDays(ymd, n) {
    var d = new Date(ymd + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function dmy(ymd) { var a = ymd.split("-"); return { y: +a[0], m: +a[1] - 1, d: +a[2] }; }
  function dateRange(start, end) {
    var s = dmy(start);
    if (!end || end === start) return s.d + " " + MONTHS[s.m] + " " + s.y;
    var e = dmy(end);
    if (s.m === e.m && s.y === e.y) return s.d + "–" + e.d + " " + MONTHS[s.m] + " " + s.y;
    return s.d + " " + MONTHS[s.m] + (s.y !== e.y ? " " + s.y : "") + " – " + e.d + " " + MONTHS[e.m] + " " + e.y;
  }
  function clock(date) {
    var p = parts(date, { hour: "numeric", minute: "2-digit" });
    var h = +p.hour, mi = p.minute;
    if (h === 12 && mi === "00") return "noon";
    if (h === 0 && mi === "00") return "midnight";
    var ap = h >= 12 ? "pm" : "am";
    var h12 = h % 12 || 12;
    return h12 + (mi === "00" ? "" : ":" + mi) + ap;
  }
  function dayMonth(date, withYear) {
    var p = parts(date, { day: "numeric", month: "short", year: "numeric" });
    return +p.day + " " + p.month + (withYear ? " " + p.year : "");
  }
  function longDate(iso) {
    var p = parts(new Date(iso), { day: "numeric", month: "long", year: "numeric" });
    return +p.day + " " + p.month + " " + p.year;
  }

  // ---- Competitions --------------------------------------------------------
  // state: "archived" | "closed" | "full" | "open" | "soon" | "none"
  function compState(c, now) {
    now = now || new Date();
    var last = c.end_date || c.start_date;
    if (last < todayLondon()) return "archived";
    if (c.kind === "event") return "none";
    var opens = c.entry_opens ? new Date(c.entry_opens) : null;
    var closes = c.entry_closes ? new Date(c.entry_closes) : null;
    if (closes && now >= closes) return "closed";
    if (c.entries_full) return "full";
    if (opens && now < opens) return "soon";
    if (opens || closes || c.entry_url) return "open";
    return "none";
  }
  function entryWindow(c) {
    if (c.kind === "event") return "";
    var o = c.entry_opens ? new Date(c.entry_opens) : null;
    var cl = c.entry_closes ? new Date(c.entry_closes) : null;
    var yearOf = c.start_date.slice(0, 4);
    if (o && cl) {
      var oy = parts(o, { year: "numeric" }).year, cy = parts(cl, { year: "numeric" }).year;
      return "Entry opens " + dayMonth(o, oy !== yearOf) + " at " + clock(o) +
        " and closes " + dayMonth(cl, cy !== oy) + " at " + clock(cl);
    }
    if (o) return "Entry opens " + dayMonth(o, true) + " at " + clock(o);
    if (cl) return "Entry closes " + dayMonth(cl, true) + " at " + clock(cl);
    return "";
  }
  // Public wording. Before entry opens it says when it opens (and not when it closes). Once open it says when it closes.
  function daysUntil(date) {
    var a = parts(date, { year: "numeric", month: "2-digit", day: "2-digit" }), t = parts(new Date(), { year: "numeric", month: "2-digit", day: "2-digit" });
    return Math.round((Date.UTC(+a.year, +a.month - 1, +a.day) - Date.UTC(+t.year, +t.month - 1, +t.day)) / 86400000);
  }
  function entryLine(c, now) {
    if (c.kind === "event") return "";
    var st = compState(c, now), o = c.entry_opens ? new Date(c.entry_opens) : null, cl = c.entry_closes ? new Date(c.entry_closes) : null;
    if (st === "soon" && o) {
      var n = daysUntil(o), at = " at " + clock(o);
      if (n <= 0) return "Entry opens today" + at;
      if (n === 1) return "Entry opens tomorrow" + at;
      if (n <= 60) return "Entry opens in " + n + " days (" + dayMonth(o, false) + ")";
      return "Entry opens " + dayMonth(o, true) + at;
    }
    if (st === "open") return "Entry open" + (cl ? ". Closes " + dayMonth(cl, false) + " at " + clock(cl) : "");
    if (st === "closed") return "Entry closed";
    return "";
  }
  // "10:00:00" -> "10am", "13:30" -> "1:30pm"
  function clockText(t) {
    if (!t) return "";
    var m = String(t).match(/^(\d{1,2}):(\d{2})/);
    if (!m) return "";
    var h = +m[1], mi = m[2];
    if (h === 12 && mi === "00") return "noon";
    if (h === 0 && mi === "00") return "midnight";
    return (h % 12 || 12) + (mi === "00" ? "" : ":" + mi) + (h >= 12 ? "pm" : "am");
  }
  // "10am to 4pm", "10am", or "" when no time is set (only for single-day items).
  function timeRange(c) {
    var a = clockText(c.start_time), b = clockText(c.end_time);
    if (!a) return "";
    return b && b !== a ? a + " to " + b : a;
  }
  function mapsUrl(c) {
    if (c.map_url) return c.map_url;
    var q = [c.venue_name, c.venue_address].filter(Boolean).join(", ");
    return q ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q) : "";
  }
  var STATE_TAG = {
    open: ["tag tag-open", "Entry open"],
    closed: ["tag tag-closed", "Entry closed"],
    full: ["tag tag-full", "Entries full"],
    soon: ["tag tag-closed", "Entry not open yet"]
  };

  // Lifting orders live at /lifting-order/<slug> (see vercel.json); the page also
  // works as /lifting/?c=<slug> where there is no rewrite rule.
  function liftingHref(c) {
    return c.slug ? "lifting-order/" + encodeURIComponent(c.slug) : "lifting/?c=" + encodeURIComponent(c.id);
  }
  function Y_EXT() {
    var s = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>');
    s.setAttribute("class", "ext-icon");
    return s;
  }

  // Renders one competition as the existing <article class="event"> markup.
  function competitionCard(c, opts) {
    opts = opts || {};
    var state = compState(c);
    var H = opts.heading || "h2";
    var title = opts.link ? el("a", { href: opts.link }, c.name) : c.name;
    var tags = [];
    if (c.kind === "event") tags.push(el("span", { class: "tag tag-event" }, "Event"));
    if (c.label) tags.push(el("span", { class: "tag tag-position" }, c.label));
    if (STATE_TAG[state] && !opts.noStatus) tags.push(el("span", { class: STATE_TAG[state][0] }, STATE_TAG[state][1]));

    var meta = el("div", { class: "event-meta" },
      el("span", null, svg(ICONS.calendar), dateRange(c.start_date, c.end_date) +
        (timeRange(c) ? ", " + timeRange(c) : "")));
    var map = mapsUrl(c);
    if (c.venue_name) {
      meta.appendChild(el("span", null, svg(ICONS.pin),
        map ? el("a", { href: map, target: "_blank", rel: "noopener", "aria-label": c.venue_name + " on Google Maps (opens in a new tab)" }, c.venue_name) : c.venue_name));
    }
    if (c.capacity) meta.appendChild(el("span", null, svg(ICONS.people), c.capacity + (c.capacity === 1 ? " space" : " spaces")));

    var card = el("article", { class: "event" },
      el("div", { class: "event-head" }, el(H, null, title), tags));
    if (c.description) {
      if (opts.brief) {
        card.appendChild(el("p", { class: "event-desc" }, excerpt(c.description, 160)));
      } else {
        var d = markdown(c.description);
        d.className = "event-desc md";
        card.appendChild(d);
      }
    }
    if (!opts.brief) {
      var line = state === "archived" ? "" : entryLine(c);
      if (line) card.appendChild(el("ul", { style: "margin-top:var(--space-2);" }, el("li", null, line)));
      if (state === "full") {
        card.appendChild(el("p", { style: "margin:var(--space-3) 0 0;" },
          c.waitlist_url ? "All places have been taken. You can join the waiting list in case one comes up." : "All places have been taken."));
      }
      // One row of actions. The main (primary) action follows the stage of the competition and the others sit
      // beside it as quieter ghost buttons:
      //   entry open    Enter now           | View entries, View lifting order
      //   entry full    Join waiting list   | View entries, View lifting order
      //   entry closed  View lifting order  | View entries            (or View entries, if there is no order yet)
      //   past          View results        | View entries, View lifting order
      var inSite = c.entry_url && c.entry_url.charAt(0) === "/";      // our own entry form opens in the same tab
      var A = {
        enter: c.entry_url && state === "open" ? el("a", inSite ? { href: c.entry_url, "aria-label": "Enter now: " + c.name }
          : { href: c.entry_url, target: "_blank", rel: "noopener", "aria-label": "Enter now: " + c.name + " (opens in a new tab)" }, "Enter now") : null,
        waitlist: state === "full" && c.waitlist_url ? (c.waitlist_url.charAt(0) === "/"
          ? el("a", { href: c.waitlist_url, "aria-label": "Join the waiting list for " + c.name }, "Join the waiting list")
          : el("a", { href: c.waitlist_url, target: "_blank", rel: "noopener", "aria-label": "Join the waiting list for " + c.name + " (opens in a new tab)" }, "Join the waiting list ", Y_EXT())) : null,
        order: c.lifting_order_url ? el("a", { href: liftingHref(c) }, "View lifting order") : null,
        entries: c.has_entries && c.slug ? el("a", { href: "/entries?c=" + encodeURIComponent(c.slug) }, "View entries") : null,
        results: c.openipf_url ? el("a", { href: c.openipf_url, target: "_blank", rel: "noopener",
          "aria-label": "View results on OpenIPF for " + c.name + " (opens in a new tab)" }, "View results on OpenIPF ", Y_EXT()) : null
      };
      var order = state === "archived" ? ["results", "order", "entries"]
        : state === "closed" ? ["order", "entries", "results"]
        : state === "full" ? ["waitlist", "entries", "order", "results"]
        : ["enter", "entries", "order", "results"];
      var actions = [], first = true;
      order.forEach(function (k) {
        if (!A[k]) return;
        A[k].className = "btn " + (first ? "btn-primary" : "btn-ghost");
        first = false; actions.push(A[k]);
      });
      if (actions.length) card.appendChild(el("div", { class: "event-actions" }, actions));
    }
    card.appendChild(meta);
    return card;
  }

  // ---- Google Sheets (records) -----------------------------------------------
  // Accepts a "Publish to web" link, a CSV link, or a normal share link, and
  // returns the address of the sheet's CSV. Returns "" if it is not usable.
  function sheetCsvUrl(raw) {
    var u;
    try { u = new URL((raw || "").trim()); } catch (e) { return ""; }
    if (u.protocol !== "https:") return "";
    var gid = u.searchParams.get("gid") || (u.hash.match(/gid=(\d+)/) || [])[1];
    // Google adds /u/1/ (the signed-in account number) when a link is copied from the address bar; it means nothing here.
    var pub = u.pathname.match(/^\/spreadsheets(?:\/u\/\d+)?\/d\/e\/([^/]+)\/pub/);
    if (u.hostname === "docs.google.com" && pub) {
      return "https://docs.google.com/spreadsheets/d/e/" + pub[1] + "/pub?output=csv" + (gid ? "&gid=" + gid : "");
    }
    var share = u.pathname.match(/^\/spreadsheets(?:\/u\/\d+)?\/d\/([^/]+)/);
    if (u.hostname === "docs.google.com" && share) {
      return "https://docs.google.com/spreadsheets/d/" + share[1] + "/export?format=csv&gid=" + (gid || "0");
    }
    return u.toString(); // any other CSV host
  }
  // RFC 4180 CSV -> array of rows (handles quotes, commas and newlines in cells)
  function parseCsv(text) {
    var rows = [], row = [], cell = "", q = false;
    text = text.replace(/^\uFEFF/, "");
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  // Fetches a sheet and returns {header: [...], rows: [[...]]}, trimmed of blank rows/columns.
  function loadSheet(url) {
    var csv = sheetCsvUrl(url);
    if (!csv) return Promise.reject(new Error("That is not a usable link."));
    return fetch(csv).then(function (r) {
      if (!r.ok) throw new Error("The sheet could not be read (is it published to the web?).");
      return r.text();
    }).then(function (text) {
      if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("That link returned a web page, not data. Publish the sheet to the web as CSV.");
      var every = parseCsv(text).map(function (r) { return r.map(function (c) { return c.trim(); }); });
      var rows = every.filter(function (r) { return r.some(Boolean); });
      if (!rows.length) return { header: [], rows: [], all: [] };
      var width = 0;
      rows.forEach(function (r) { r.forEach(function (c, i) { if (c && i + 1 > width) width = i + 1; }); });
      rows = rows.map(function (r) { var o = r.slice(0, width); while (o.length < width) o.push(""); return o; });
      return { header: rows[0], rows: rows.slice(1), all: every };   // all = every row exactly as laid out, blanks included
    });
  }

  // Where "Submit a record" goes until the editor changes it (Records tab) or if settings are not available.
  var RECORDS_FORM_DEFAULT = "https://docs.google.com/forms/d/e/1FAIpQLScXK1vfOAfL0xJLbhIyLrcrOh2i4tu7sm2LW8xNrDRR2yyoug/viewform";

  // ---- Records (the divisional records sheets) ----------------------------------
  // The sheet is laid out for people, not as a flat table: a title row, then one block
  // per weight class. A block starts with the class in column A and the age classes
  // across the same row. Each lift is a stack (standards, then the history of who held
  // the record), ending in the CURRENT record, labelled SQUAT, BENCH, DEADLIFT, TOTAL or
  // BENCH (A/C), over three rows: weight, then the holder's name ("standard" when
  // nobody has beaten the standard yet), then the date. parseRecords reads that layout
  // and returns null for any other sheet, which is then shown as a plain table.
  var REC_LIFTS = [["SQUAT", "Squat"], ["BENCH", "Bench press"], ["DEADLIFT", "Deadlift"], ["TOTAL", "Total"], ["BENCH (A/C)", "Bench (A/C)"]];
  var REC_AGE = /^(u\d+|open|m[1-4]|sj|j)$/i;
  function recAge(t) { return /^open$/i.test(t) ? "Open" : t.toUpperCase(); }
  function recDate(t) {
    var m = (t || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? ("0" + m[1]).slice(-2) + "/" + ("0" + m[2]).slice(-2) + "/" + m[3] : (t || "");
  }
  function parseRecords(all) {
    if (!all || all.length < 4) return null;
    var cell = function (r, c) { return ((r && r[c]) || "").trim(); };
    var title = cell(all[0], 0), up = title.match(/updated\s+(.+)$/i);
    var blocks = [], cur = null;
    for (var i = 1; i < all.length; i++) {
      var r = all[i];
      if (cell(r, 0)) {
        var cols = [];
        for (var c = 1; c < r.length; c++) if (REC_AGE.test(cell(r, c))) cols.push({ c: c, age: recAge(cell(r, c)) });
        if (cols.length) { cur = { label: cell(r, 0), cols: cols, labelled: [] }; blocks.push(cur); continue; }
      }
      if (cur) {
        var key = cell(r, 1).toUpperCase().replace(/\s+/g, " ");
        if (REC_LIFTS.some(function (l) { return l[0] === key; })) cur.labelled.push({ i: i, key: key });
      }
    }
    var classes = blocks.map(function (b) {
      var lifts = [];
      REC_LIFTS.forEach(function (l, k) {
        // The current record is the LAST row with this label before the next lift's stack begins.
        var boundary = Infinity;
        for (var n = k + 1; n < REC_LIFTS.length && boundary === Infinity; n++) {
          b.labelled.forEach(function (x) { if (x.key === REC_LIFTS[n][0] && x.i < boundary) boundary = x.i; });
        }
        var pick = null;
        b.labelled.forEach(function (x) {
          if (x.key !== l[0] || x.i >= boundary) return;
          var hasWeight = b.cols.some(function (col) { return /^\d+(\.\d+)?$/.test(cell(all[x.i], col.c)); });
          if (hasWeight) pick = x.i;
        });
        if (pick === null) return;
        var cells = {};
        b.cols.forEach(function (col) {
          var w = cell(all[pick], col.c), n = cell(all[pick + 1], col.c), d = cell(all[pick + 2], col.c);
          if (!w && !n && !d) { cells[col.age] = null; return; }
          var std = /^standard$/i.test(n);
          if (std && !(parseFloat(w) > 0)) { cells[col.age] = null; return; }   // no record and no standard: nothing to show
          cells[col.age] = { weight: w, standard: std, holder: std ? "" : n, date: std ? "" : recDate(d) };
        });
        lifts.push({ key: l[0], label: l[1], cells: cells });
      });
      return { label: b.label, ages: b.cols.map(function (col) { return col.age; }), lifts: lifts };
    }).filter(function (b) { return b.lifts.length; });
    return classes.length ? { title: title, updated: up ? up[1].trim() : "", classes: classes } : null;
  }

  // ---- Lifting order (a published Google Sheet, one row per lifter) -------------
  // Needs columns Day, Session, Flight, Name. Optional: Open IPF, Instagram, Age,
  // Class, GLP, and per-session Weigh-in, Lift off and Session name.
  var LO_COLS = {
    day: ["day"], session: ["session"], flight: ["flight"], name: ["name"],
    openIpf: ["open ipf", "openipf"], instagram: ["instagram"], ageClass: ["age class", "age category", "age division", "division"],
    cls: ["class", "weight class"], glp: ["glp"],
    club: ["club", "team", "gym"], total: ["total", "total (kg)", "kg", "best total", "best total (kg)"],
    weighIn: ["weigh-in", "weigh in", "weighin"], liftOff: ["lift off", "lift-off", "liftoff"],
    sessionName: ["session name", "session label"]
  };
  function igHandle(s) {
    return (s || "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  }
  // Age class: blank means Open. Otherwise J (junior), SJ (sub-junior) or M1 to M4 (masters 1 to 4).
  var AGE_CLASSES = { OPEN: "Open", SJ: "SJ", J: "J", M1: "M1", M2: "M2", M3: "M3", M4: "M4" };
  var AGE_NAMES = { Open: "Open", SJ: "Sub-junior", J: "Junior", M1: "Masters 1", M2: "Masters 2", M3: "Masters 3", M4: "Masters 4" };
  // Returns { value, known }. Accepts J, SJ, M1 to M4 and the spelt-out names, in any case.
  function ageClass(raw) {
    var t = (raw || "").trim();
    if (!t) return { value: "Open", known: true };
    var k = t.toUpperCase().replace(/[\s\-_.]+/g, "");
    var named = { OPEN: "OPEN", O: "OPEN", JUNIOR: "J", JUNIORS: "J", SUBJUNIOR: "SJ", SUBJUNIORS: "SJ",
      MASTERS1: "M1", MASTER1: "M1", MASTERS2: "M2", MASTER2: "M2", MASTERS3: "M3", MASTER3: "M3", MASTERS4: "M4", MASTER4: "M4" };
    k = named[k] || k;
    return AGE_CLASSES[k] ? { value: AGE_CLASSES[k], known: true } : { value: t, known: false };
  }
  // A usable Instagram handle, or "" (links and @ are stripped first).
  function igValid(raw) {
    var h = igHandle(raw);
    return /^[A-Za-z0-9._]{1,30}$/.test(h) ? h : "";
  }
  function parseLiftingOrder(sheet) {
    var head = sheet.header.map(function (h) { return h.trim().toLowerCase(); });
    var idx = {};
    Object.keys(LO_COLS).forEach(function (k) {
      idx[k] = -1;
      LO_COLS[k].forEach(function (alias) { if (idx[k] < 0) idx[k] = head.indexOf(alias); });
    });
    var missing = ["day", "session", "flight", "name"].filter(function (k) { return idx[k] < 0; });
    if (missing.length) {
      throw new Error("The sheet needs columns called Day, Session, Flight and Name (missing: " + missing.join(", ") + ").");
    }
    var get = function (r, k) { return idx[k] < 0 ? "" : (r[idx[k]] || "").trim(); };
    var warnings = [];
    var lifters = sheet.rows.map(function (r) {
      var glp = parseFloat(get(r, "glp"));
      var ac = ageClass(get(r, "ageClass"));
      var ig = igValid(get(r, "instagram"));
      var name = get(r, "name");
      if (name && !ac.known) warnings.push(name + ": age class “" + ac.value + "” is not J, SJ, M1, M2, M3, M4 or blank");
      if (name && get(r, "instagram") && !ig) warnings.push(name + ": Instagram “" + get(r, "instagram") + "” is not a valid handle, so no icon is shown");
      return {
        day: parseInt(get(r, "day"), 10), session: parseInt(get(r, "session"), 10), flight: get(r, "flight"),
        name: name, openIpf: /^https:\/\//i.test(get(r, "openIpf")) ? get(r, "openIpf") : "",
        instagram: ig, ageClass: ac.value, ageClassKnown: ac.known, cls: get(r, "cls"),
        club: get(r, "club"), total: get(r, "total"),
        glp: isFinite(glp) ? glp : null,
        weighIn: get(r, "weighIn"), liftOff: get(r, "liftOff"), sessionName: get(r, "sessionName")
      };
    }).filter(function (l) { return l.name && isFinite(l.day) && isFinite(l.session) && l.flight; });
    var flights = {};
    lifters.forEach(function (l) { flights[l.day + "-" + l.session + "-" + l.flight] = 1; });
    return { lifters: lifters, flightCount: Object.keys(flights).length, warnings: warnings };
  }
  function longDay(ymd) {
    var p = {};
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" })
      .formatToParts(new Date(ymd + "T12:00:00Z")).forEach(function (x) { p[x.type] = x.value; });
    return p.weekday + " " + p.day + " " + p.month + " " + p.year;
  }

  // ---- Page status helpers --------------------------------------------------
  function notice(target, message, kind) {
    target.replaceChildren(el("div", { class: "callout", role: kind === "error" ? "alert" : "status" },
      el("p", { class: "callout-title" }, kind === "error" ? "Something went wrong" : "Nothing to show yet"),
      el("p", { style: "margin:0;" }, message)));
  }
  function guard(target) {
    if (db()) return true;
    notice(target, "This page loads its content from our database, which has not been connected yet.", "error");
    return false;
  }

  window.YNEPF = {
    TZ: TZ, db: db, configured: configured, el: el, svg: svg, ICONS: ICONS,
    markdown: markdown, excerpt: excerpt, anchorSlug: anchorSlug,
    toLondonInput: toLondonInput, fromLondonInput: fromLondonInput,
    todayLondon: todayLondon, yearOf: function (c) { return c.start_date.slice(0, 4); }, addDays: addDays, dateRange: dateRange, longDate: longDate,
    compState: compState, timeRange: timeRange, entryLine: entryLine, entryWindow: entryWindow, mapsUrl: mapsUrl, competitionCard: competitionCard,
    parseLiftingOrder: parseLiftingOrder, parseRecords: parseRecords, RECORDS_FORM_DEFAULT: RECORDS_FORM_DEFAULT, AGE_NAMES: AGE_NAMES, liftingHref: liftingHref, longDay: longDay, igHandle: igHandle,
    extIcon: Y_EXT, sheetCsvUrl: sheetCsvUrl, parseCsv: parseCsv, loadSheet: loadSheet,
    notice: notice, guard: guard
  };
})();
