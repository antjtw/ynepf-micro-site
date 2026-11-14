/* ==========================================================================
   enter.js: the entry form (/enter?c=<competition address>).

   Three steps (About you, Your lifting, Check your answers), then payment inside
   this page with Stripe's embedded Checkout. The page only SHOWS prices; the real
   rules and price are decided by the database function start_entry() when the
   entry-checkout function runs, so nothing here can be used to get a cheaper entry
   or an extra place. Errors follow the GOV.UK pattern (summary + per-field message).
   ========================================================================== */
(function () {
  "use strict";
  var Y = window.YNEPF, el = Y.el, CFG = window.YNEPF_CONFIG || {};
  var app = document.getElementById("enter-app"), status = document.getElementById("enter-status");
  var summary = document.getElementById("error-summary"), list = document.getElementById("error-list");
  var lede = document.getElementById("enter-lede"), title = document.getElementById("enter-title");
  var ctx = null;                               // competition, settings, price rules, classes, divisions
  var step = "about", preview = false, invite = "", offer = "", offerInfo = null, countdown = null;
  var v = { sex: "", event: "", equipment: "", weight_class_id: "", division_id: "", dd: "", mm: "", yyyy: "" };
  var EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  var EVENT_NAMES = { full_power: "Full power", bench_only: "Bench only" };
  var EVENT_HINTS = { full_power: "Squat, bench press and deadlift.", bench_only: "Bench press only." };
  var EQUIP_NAMES = { classic: "Classic", equipped: "Equipped" };
  var EQUIP_HINTS = { classic: "Knee sleeves, wrist wraps and a belt, competing in a singlet.", equipped: "Supportive equipment such as knee wraps, a squat suit, a bench shirt and a deadlift suit." };
  var PHOTO_NAMES = { yes: "I consent", no: "I do not consent", never: "I do not wish to be photographed or filmed at all" };

  // ---- rules that mirror the database (the database is the one that decides) ------------------
  function ageCategory(yearOfBirth, compYear) {
    var d = compYear - yearOfBirth;
    if (d >= 14 && d <= 18) return "SJ"; if (d >= 19 && d <= 23) return "J"; if (d >= 24 && d <= 39) return "";
    if (d >= 40 && d <= 49) return "M1"; if (d >= 50 && d <= 59) return "M2"; if (d >= 60 && d <= 69) return "M3"; if (d >= 70) return "M4";
    return "under14";
  }
  // "You are an M2 lifter", "a sub-junior lifter", "an open lifter" (the year they turn the age decides, not the day).
  var CAT_NAMES = { SJ: "a sub-junior lifter", J: "a junior lifter", "": "an open lifter", M1: "an M1 lifter (Masters 1)", M2: "an M2 lifter (Masters 2)", M3: "an M3 lifter (Masters 3)", M4: "an M4 lifter (Masters 4)" };
  var CAT_SHORT = { SJ: "Sub-junior", J: "Junior", "": "Open", M1: "Masters 1 (M1)", M2: "Masters 2 (M2)", M3: "Masters 3 (M3)", M4: "Masters 4 (M4)" };
  function catNote() {
    var c = myCategory();
    return c === null ? "" : ["For this competition ", el("strong", null, "you are " + CAT_NAMES[c] + "."), " We work this out from the year you were born."];
  }
  function updateCatNote() {
    var n = document.getElementById("cat-note"); if (!n) return;
    n.replaceChildren(); var c = catNote();
    if (c) c.forEach(function (x) { n.appendChild(typeof x === "string" ? document.createTextNode(x) : x); });
    n.hidden = !c;
  }
  function myCategory() {
    var iso = dobISO(); if (!iso) return null;
    var c = ageCategory(+iso.slice(0, 4), +ctx.comp.start_date.slice(0, 4));
    return c === "under14" ? null : c;
  }
  function dobISO() {
    var d = +v.dd, m = +v.mm, y = +v.yyyy;
    if (!d || !m || !y || String(v.yyyy).length !== 4) return null;
    var dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return y + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2);
  }
  function ageOnDay() {
    var iso = dobISO(); if (!iso) return null;
    var c = ctx.comp.start_date.split("-").map(Number), b = iso.split("-").map(Number);
    var age = c[0] - b[0]; if (c[1] < b[1] || (c[1] === b[1] && c[2] < b[2])) age--;
    return age;
  }
  // ---- federation / division and club ---------------------------------------------------------------
  function division() { return ctx.divisions.filter(function (d) { return d.id === v.division_id; })[0] || null; }
  // Anyone outside our own division is a guest, and guests can enter only some days after entry opens.
  function guestOpensAt() {
    var d = division();
    if (!d || d.is_home || !ctx.comp.entry_opens) return null;
    return new Date(new Date(ctx.comp.entry_opens).getTime() + (ctx.settings.guest_delay_days || 0) * 86400000);
  }
  function guestBlocked() { var t = guestOpensAt(); return !!t && t > new Date(); }
  function whenText(d) { return d.toLocaleString("en-GB", { timeZone: Y.TZ, dateStyle: "full", timeStyle: "short" }); }
  // Classes this lifter may enter: men's 53 and women's 43 are for sub-juniors only (the database checks this too).
  function allowedClasses() {
    var iso = dobISO(), cat = iso ? ageCategory(+iso.slice(0, 4), +ctx.comp.start_date.slice(0, 4)) : null;
    return ctx.classes.filter(function (c) { return c.sex === v.sex && (!c.min_age_category || c.min_age_category === cat); });
  }
  function priceNow() {
    var iso = dobISO(); if (!iso || !v.event || !v.equipment) return null;
    var cat = ageCategory(+iso.slice(0, 4), +ctx.comp.start_date.slice(0, 4));
    for (var i = 0; i < ctx.rules.length; i++) {
      var r = ctx.rules[i];
      if ((!r.event || r.event === v.event) && (!r.equipment || r.equipment === v.equipment) && (!r.age_category || r.age_category === cat)) return r.price_pence;
    }
    return null;
  }
  function pounds(p) { return "£" + (p / 100).toFixed(p % 100 ? 2 : 0); }

  // ---- extras (photo package, merchandise) ----------------------------------------------------------
  // v.extras maps an extra's id to "yes" (no sizes) or to the chosen size's id. Nothing here moves on the page: each extra is
  // always on screen as a tick box or a drop-down.
  function chosenExtras() {
    return (ctx.extras || []).filter(function (x) { return v.extras && v.extras[x.id]; }).map(function (x) {
      var opt = (x.addon_options || []).filter(function (o) { return o.id === v.extras[x.id]; })[0];
      return { id: x.id, name: x.name, price_pence: x.price_pence, option_id: opt ? opt.id : null, option: opt ? opt.label : "" };
    });
  }
  function extrasNow() { return chosenExtras().reduce(function (n, x) { return n + x.price_pence; }, 0); }
  function extrasField() {
    var items = ctx.extras || [];
    if (!items.length) return null;
    v.extras = v.extras || {};
    return el("div", { class: "field", "data-field": "extras" },
      el("fieldset", { class: "choice", id: "extras-field" },
        el("legend", null, "Extras (optional)"),
        el("p", { class: "help", id: "extras-help" }, "You can add these to your entry. Discount codes only apply to the entry fee."),
        items.map(function (x, i) {
          var opts = (x.addon_options || []).slice().sort(function (p, q) { return p.sort_order - q.sort_order; });
          var label = x.name + ", " + pounds(x.price_pence);
          if (opts.length) {
            return el("div", { class: "field" },
              el("label", { for: "extra-" + i }, label),
              x.description ? el("p", { class: "help", id: "extra-" + i + "-help" }, x.description) : null,
              el("select", { id: "extra-" + i, name: "extra-" + i, "aria-describedby": x.description ? "extra-" + i + "-help" : false,
                onchange: function (e) { v.extras[x.id] = e.target.value; refreshTotals(); } },
                el("option", { value: "" }, "No thank you"), opts.map(function (o) { return el("option", { value: o.id, selected: v.extras[x.id] === o.id }, "Size " + o.label); })));
          }
          return el("div", { class: "field-check" },
            el("input", { id: "extra-" + i, name: "extra-" + i, type: "checkbox", checked: !!v.extras[x.id], "aria-describedby": x.description ? "extra-" + i + "-hint" : false,
              onchange: function (e) { v.extras[x.id] = e.target.checked ? "yes" : ""; refreshTotals(); } }),
            el("div", null, el("label", { for: "extra-" + i }, label), x.description ? el("p", { class: "help", id: "extra-" + i + "-hint" }, x.description) : null));
        })));
  }

  // ---- discount code -------------------------------------------------------------------------------
  // The price to pay: the discount (if a code has been applied) taken off.
  function totalNow() { var a = v.discount_applied, base = a ? a.price_pence : priceNow(); return base === null ? null : base + extrasNow(); }
  function refreshTotals() {
    updateFee();
    var t = totalNow(), free = t === 0;
    var tl = document.getElementById("total-line"); if (tl) tl.replaceChildren(document.createTextNode("Total to pay: "), el("strong", null, t === null ? "—" : pounds(t)));
    var btn = document.getElementById("pay-btn"); if (btn && !btn.disabled) btn.textContent = free ? "Confirm your entry" : "Continue to payment";
    ["hold-note", "refund-note"].forEach(function (id) { var n = document.getElementById(id); if (n) n.hidden = free; });
  }
  function discountStatus(text, bad) {
    var n = document.getElementById("discount-status"); if (!n) return;
    n.textContent = text || ""; n.className = "help" + (bad ? " discount-bad" : "");
  }
  function applyDiscount() {
    var input = document.getElementById("discount_code"), code = trim(input && input.value).toUpperCase();
    v.discount_input = input ? input.value : "";
    if (!code) { v.discount_applied = null; discountStatus("Enter your code first.", true); return refreshTotals(); }
    var btn = document.getElementById("discount-apply"); if (btn) btn.disabled = true;
    discountStatus("Checking…");
    fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/entry-checkout", {
      method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey || "" },
      body: JSON.stringify({ action: "discount", competition_id: ctx.comp.id, email: trim(v.email), code: code, date_of_birth: dobISO(), event: v.event, equipment: v.equipment })
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (b) {
      if (b.ok) {
        v.discount_applied = { code: code, discount_pence: b.discount_pence, price_pence: b.price_pence };
        discountStatus("Code applied: " + pounds(b.discount_pence) + " off." + (b.price_pence === 0 ? " Your entry is free." : ""));
      } else { v.discount_applied = null; discountStatus(b.message || "That code could not be checked. Please try again.", true); }
      refreshTotals();
    }).catch(function () { v.discount_applied = null; discountStatus("That code could not be checked. Please try again.", true); refreshTotals(); })
      .then(function () { if (btn) btn.disabled = false; });
  }
  function discountField() {
    var applied = v.discount_applied;
    return el("div", { class: "field", "data-field": "discount_code" },
      el("label", { for: "discount_code" }, "Discount code (optional)"),
      el("p", { class: "help", id: "discount_code-help" }, "If you have a code, enter it and press Apply."),
      el("div", { class: "discount-row" },
        el("input", { id: "discount_code", name: "discount_code", type: "text", value: v.discount_input || "", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", maxlength: "40", "aria-describedby": "discount_code-help discount-status",
          oninput: function (e) { v.discount_input = e.target.value; if (v.discount_applied && trim(e.target.value).toUpperCase() !== v.discount_applied.code) { v.discount_applied = null; discountStatus(""); refreshTotals(); } },
          onkeydown: function (e) { if (e.key === "Enter") { e.preventDefault(); applyDiscount(); } } }),
        el("button", { class: "btn btn-secondary", type: "button", id: "discount-apply", onclick: applyDiscount }, "Apply")),
      el("p", { class: "help", id: "discount-status", role: "status" }, applied ? "Code applied: " + pounds(applied.discount_pence) + " off." + (applied.price_pence === 0 ? " Your entry is free." : "") : ""));
  }

  // ---- errors ----------------------------------------------------------------------------------
  function clearErrors() {
    summary.hidden = true; list.innerHTML = "";
    Array.prototype.forEach.call(app.querySelectorAll(".field-error"), function (p) { p.hidden = true; p.textContent = ""; });
    Array.prototype.forEach.call(app.querySelectorAll(".has-error"), function (f) { f.classList.remove("has-error"); });
  }
  function showErrors(errs) {
    clearErrors();
    errs.forEach(function (e) {
      var li = el("li", null, el("a", { href: "#" + e[0] }, e[1])); list.appendChild(li);
      var f = app.querySelector('[data-field="' + e[0] + '"]'), msg = document.getElementById(e[0] + "-error");
      if (f) f.classList.add("has-error"); if (msg) { msg.textContent = e[1]; msg.hidden = false; }
    });
    summary.hidden = false; summary.focus();
  }

  // ---- the steps. A lifter under 18 on the day gets an extra "Parent or guardian" step, so nothing is added into a page
  // while it is being filled in.
  var STEP_NAMES = { about: "About you", guardian: "Parent or guardian", lifting: "Your lifting", check: "Check your answers" };
  function needGuardian() { var a = ageOnDay(); return a !== null && a < 18; }
  function stepList() { return needGuardian() ? ["about", "guardian", "lifting", "check"] : ["about", "lifting", "check"]; }
  function goStep(key) { step = key; render(); window.scrollTo(0, 0); }

  // ---- little form builders --------------------------------------------------------------------
  function text(id, label, opts) {
    opts = opts || {};
    return el("div", { class: "field", "data-field": id },
      el("label", { for: id }, label + (opts.optional ? " (optional)" : "")),
      opts.help ? el("p", { class: "help", id: id + "-help" }, opts.help) : null,
      el("p", { class: "field-error", id: id + "-error", hidden: true }),
      el("input", { id: id, name: id, type: opts.type || "text", value: v[id] || "", autocomplete: opts.autocomplete || "off", maxlength: opts.max || 200,
        spellcheck: "false", readonly: opts.readonly ? "readonly" : false, "aria-describedby": opts.help ? id + "-help" : false, oninput: function (e) { v[id] = e.target.value; } }));
  }
  function check(id, label, help) {
    return el("div", { class: "field", "data-field": id },
      el("p", { class: "field-error", id: id + "-error", hidden: true }),
      el("div", { class: "field-check" },
        el("input", { id: id, name: id, type: "checkbox", checked: !!v[id], "aria-describedby": help ? id + "-hint" : false, onchange: function (e) { v[id] = e.target.checked; if (id === "guardian_consent") return; } }),
        el("div", null, el("label", { for: id }, label), help ? el("p", { class: "help", id: id + "-hint" }, help) : null)));
  }
  // options: [value, label, hint?]. No box around the choices, and a short hint under each if given.
  function radios(id, legend, options, help) {
    return el("div", { class: "field", "data-field": id },
      el("fieldset", { class: "choice", id: id, tabindex: "-1" },
        el("legend", null, legend), help ? el("p", { class: "help" }, help) : null,
        el("p", { class: "field-error", id: id + "-error", hidden: true }),
        options.map(function (o, i) {
          var rid = id + "-" + i;
          return el("div", { class: "field-check" },
            el("input", { id: rid, type: "radio", name: id, value: o[0], checked: v[id] === o[0], "aria-describedby": o[2] ? rid + "-hint" : false, onchange: function () { v[id] = o[0]; if (id === "sex") v.weight_class_id = ""; if (id === "event" || id === "equipment") updateFee(); } }),
            el("div", null, el("label", { for: rid }, o[1]), o[2] ? el("p", { class: "help", id: rid + "-hint" }, o[2]) : null));
        })));
  }
  function select(id, label, options, blank, help) {
    return el("div", { class: "field", "data-field": id },
      el("label", { for: id }, label), help ? el("p", { class: "help", id: id + "-help" }, help) : null, el("p", { class: "field-error", id: id + "-error", hidden: true }),
      el("select", { id: id, name: id, "aria-describedby": help ? id + "-help" : false, onchange: function (e) { v[id] = e.target.value; } },
        el("option", { value: "" }, blank), options.map(function (o) { return el("option", { value: o[0], selected: v[id] === o[0] }, o[1]); })));
  }
  function dobField() {
    function part(k, label, w, max) {
      return el("div", { class: "date-part" }, el("label", { for: "dob-" + k }, label),
        el("input", { id: "dob-" + k, type: "text", inputmode: "numeric", maxlength: max, size: w, value: v[k], autocomplete: k === "dd" ? "bday-day" : k === "mm" ? "bday-month" : "bday-year", oninput: function (e) { v[k] = e.target.value; updateCatNote(); }, onchange: updateCatNote }));
    }
    return el("div", { class: "field", "data-field": "dob" },
      el("fieldset", { class: "choice", id: "dob", tabindex: "-1" }, el("legend", null, "Date of birth"),
        el("p", { class: "help" }, "For example, 27 3 1990. We use it to work out your age category. It is never published."),
        el("p", { class: "field-error", id: "dob-error", hidden: true }),
        el("div", { style: "display:flex;gap:1rem;flex-wrap:wrap" }, part("dd", "Day", 3, 2), part("mm", "Month", 3, 2), part("yyyy", "Year", 5, 4))));
  }

  // ---- steps -----------------------------------------------------------------------------------
  // Always shown with the question (so nothing appears when a division is picked): when guests can start entering.
  function guestNote() {
    var days = ctx.settings.guest_delay_days || 0;
    if (!ctx.comp.entry_opens || !days) return "";
    var t = new Date(new Date(ctx.comp.entry_opens).getTime() + days * 86400000);
    return t > new Date() ? " Guests can enter from " + whenText(t) + "." : "";
  }
  function divisionField() {
    return el("div", { class: "field", "data-field": "division_id" },
      el("label", { for: "division_id" }, "Which federation or division are you part of?"),
      el("p", { class: "help", id: "division_id-help" }, "Choose the one you are registered with. If it is not the Yorkshire & North East division, you enter as a guest." + guestNote()),
      el("p", { class: "field-error", id: "division_id-error", hidden: true }),
      el("select", { id: "division_id", name: "division_id", "aria-describedby": "division_id-help", onchange: function (e) { v.division_id = e.target.value; } },
        el("option", { value: "" }, "Choose your federation or division"),
        ctx.divisions.map(function (d) { return el("option", { value: d.id, selected: v.division_id === d.id }, d.name); })));
  }
  function clubField() {
    if (!ctx.clubs.length) return null;      // nothing to choose from until the club list has been imported
    return el("div", { class: "field", "data-field": "club" },
      el("label", { for: "club" }, "Club (optional)"),
      el("p", { class: "help", id: "club-help" }, "Select your club from the list of English Powerlifting Association (EPA) approved clubs."),
      el("p", { class: "field-error", id: "club-error", hidden: true }),
      el("select", { id: "club", name: "club", "aria-describedby": "club-help", onchange: function (e) { v.club = e.target.value; } },
        el("option", { value: "" }, "Select your club"),
        ctx.clubs.map(function (c) { return el("option", { value: c.name, selected: v.club === c.name }, c.name); })));
  }
  function stepAbout() {
    return [
      text("full_name", "Full name", { autocomplete: "name", help: "Your name, club and weight class are shown on the entries list and the lifting order." }),
      text("email", "Email address", { type: "email", autocomplete: "email", max: 254, readonly: !!offerInfo, help: offerInfo ? "Your place was offered to this address, so it cannot be changed." : "We send your confirmation here." }),
      dobField(),
      el("p", { class: "callout", id: "cat-note", role: "status", hidden: myCategory() === null }, catNote()),
      radios("sex", "Which category are you entering?", [["M", "Men's"], ["F", "Women's"]],
        ["This should usually match your sex at birth. If you are a transgender athlete, please ", el("a", { href: "contact.html", target: "_blank", rel: "noopener" }, "contact us", el("span", { class: "visually-hidden" }, " (opens in a new tab)")), " before you enter and we will talk it through."]),
      divisionField(),
      clubField(),
      text("bp_number", "British Powerlifting membership number", { max: 40, help: "This is displayed in your Sport80 profile." }),
      text("instagram", "Instagram handle (optional)", { max: 60, help: "This will be displayed next to your name on the lifting order, and will be public." }),
      radios("photo_choice", "Do you consent to photos or videos of you being used in YNEPF promotional material?",
        [["yes", PHOTO_NAMES.yes], ["no", PHOTO_NAMES.no], ["never", PHOTO_NAMES.never]])
    ];
  }
  function stepGuardian() {
    return [
      el("h2", { class: "form-heading", style: "margin-top:0" }, "Parent or guardian"),
      el("p", null, "You are under 18 on the day of the competition, so we need you to name a parent or guardian who will be with you."),
      el("p", null, "They will need to be with you for weigh-in and on hand throughout the rest of the day. Please give their contact details. We will only use them as an emergency contact, or if we have a question about your entry. Only the entries team can see them, and we delete them 30 days after the competition."),
      text("guardian_name", "Parent or guardian's full name", { max: 120, autocomplete: "off" }),
      text("guardian_phone", "Their phone number", { type: "tel", max: 30, autocomplete: "off" }),
      text("guardian_email", "Their email address", { type: "email", max: 254, autocomplete: "off" }),
      check("guardian_consent", "I am the parent or guardian, or I have their permission, and I consent to this entry and to photos being taken")
    ];
  }
  // The fee line is always on the page; only its words change when the event and equipment are chosen.
  function feeText() { var p = priceNow(), x = extrasNow(); return p === null ? "Your entry fee: choose an event and equipment." : "Your entry fee: " + pounds(p) + (x ? ". With extras: " + pounds(p + x) : ""); }
  function updateFee() { var n = document.getElementById("fee-line"); if (n) n.textContent = feeText(); }
  function stepLifting() {
    var allowed = allowedClasses();
    if (v.weight_class_id && !allowed.some(function (c) { return c.id === v.weight_class_id; })) v.weight_class_id = "";
    var classes = allowed.map(function (c) { return [c.id, c.label + " kg"]; });
    return [
      radios("event", "Which event do you wish to compete in?", ctx.settings.events.map(function (e) { return [e, EVENT_NAMES[e] || e, EVENT_HINTS[e]]; })),
      radios("equipment", "Equipment", ctx.settings.equipment.map(function (e) { return [e, EQUIP_NAMES[e] || e, EQUIP_HINTS[e]]; })),
      select("weight_class_id", "Weight class", classes, classes.length ? "Choose your class" : "Choose men's or women's first",
        "The weight class you intend to compete in on the day. If you miss weight on the day, you can still compete as a guest."),
      ctx.settings.openipf_mode === "hidden" ? null : text("openipf_url", "OpenIPF profile link", ctx.settings.openipf_mode === "required"
        ? { max: 300, help: "Entry to this competition needs a qualifying total, so we need your link from openipf.org (it looks like https://www.openipf.org/u/yourname)." }
        : { optional: true, max: 300, help: "If you have one, paste your link from openipf.org. We use it to check qualification." }),
      extrasField(),
      el("p", { class: "lede", id: "fee-line", role: "status" }, feeText())
    ];
  }
  // Refunds stop when entries close: the same rule for everyone.
  function refundNote() {
    if (!ctx.comp.entry_closes) return null;
    var d = new Date(ctx.comp.entry_closes).toLocaleString("en-GB", { timeZone: Y.TZ, dateStyle: "full", timeStyle: "short" });
    return el("p", { class: "help", id: "refund-note", hidden: totalNow() === 0 }, "Refunds are available until entries close on " + d + ". After that, entries cannot be refunded.");
  }
  // A summary list like GOV.UK's: label, answer, and a plain "Change" link on each row.
  function row(label, value, stepKey, hideChange) {
    return el("div", { class: "summary-row" },
      el("dt", null, label),
      el("dd", { class: "summary-value" }, value || "Not given"),
      el("dd", { class: "summary-action" }, hideChange ? null : el("a", { href: "#", onclick: function (ev) { ev.preventDefault(); goStep(stepKey); } }, "Change", el("span", { class: "visually-hidden" }, " " + label.toLowerCase()))));
  }
  function stepCheck() {
    var cls = ctx.classes.filter(function (c) { return c.id === v.weight_class_id; })[0], p = priceNow(), age = ageOnDay(), d = division();
    var rows = [
      row("Name", v.full_name, "about"), row("Email address", v.email, "about"), row("Date of birth", v.dd + " " + v.mm + " " + v.yyyy, "about"),
      row("Category", (v.sex === "M" ? "Men's" : "Women's") + (myCategory() !== null ? ", " + CAT_SHORT[myCategory()] : ""), "about"),
      row("Federation or division", d ? d.name + (d.is_home ? "" : " (guest)") : "", "about")
    ];
    if (ctx.clubs.length) rows.push(row("Club", v.club, "about"));
    rows.push(row("Membership number", v.bp_number, "about"), row("Instagram handle", trim(v.instagram) ? "@" + trim(v.instagram).replace(/^@/, "") : "", "about"));
    if (age !== null && age < 18) rows.push(row("Parent or guardian", trim(v.guardian_name), "guardian"), row("Their phone number", trim(v.guardian_phone), "guardian"), row("Their email address", trim(v.guardian_email), "guardian"));
    rows.push(row("Photos and videos", PHOTO_NAMES[v.photo_choice], "about"),
      row("Event", EVENT_NAMES[v.event], "lifting"), row("Equipment", EQUIP_NAMES[v.equipment], "lifting"), row("Weight class", cls ? cls.label + " kg" : "", "lifting"));
    if (trim(v.openipf_url)) rows.push(row("OpenIPF profile", trim(v.openipf_url), "lifting"));
    chosenExtras().forEach(function (x) { rows.push(row(x.name + (x.option ? " (size " + x.option + ")" : ""), pounds(x.price_pence), "lifting")); });
    return [
      el("h2", null, "Check your answers"),
      el("dl", { class: "summary-list" }, rows),
      age !== null && age < 18 ? el("p", { class: "help" }, "A parent or guardian must be with you at the competition.") : null,
      discountField(),
      el("p", { class: "lede", id: "total-line" }, "Total to pay: ", el("strong", null, totalNow() === null ? "—" : pounds(totalNow()))),
      el("p", { class: "help", id: "hold-note", hidden: totalNow() === 0 }, "Pressing the button holds your place for " + ctx.settings.hold_minutes + " minutes while you pay. We never see or store your card details."),
      refundNote(),
      el("p", { class: "field-error", id: "submit-error", hidden: true })
    ];
  }

  // ---- validation per step ---------------------------------------------------------------------
  function trim(s) { return (s || "").replace(/^\s+|\s+$/g, ""); }
  function validate(n) {
    var e = [];
    if (n === "about") {
      if (!trim(v.full_name)) e.push(["full_name", "Enter your full name"]);
      if (!trim(v.email)) e.push(["email", "Enter your email address"]);
      else if (!EMAIL.test(trim(v.email))) e.push(["email", "Enter an email address in the correct format, like name@example.com"]);
      var iso = dobISO();
      if (!iso) e.push(["dob", "Enter your date of birth as a real date, for example 27 3 1990"]);
      else { var age = ageOnDay(); if (age < 14 && ageCategory(+iso.slice(0, 4), +ctx.comp.start_date.slice(0, 4)) === "under14") e.push(["dob", "Lifters must be at least 14 in the year of the competition"]); }
      if (!v.sex) e.push(["sex", "Choose men's or women's"]);
      if (!trim(v.bp_number)) e.push(["bp_number", "Enter your British Powerlifting membership number from your Sport80 profile, or TBC if you do not have it yet"]);
      if (!v.division_id) e.push(["division_id", "Choose the federation or division you are part of"]);
      else if (guestBlocked()) e.push(["division_id", "Entries from outside the Yorkshire & North East division open on " + whenText(guestOpensAt())]);
      if (!v.photo_choice) e.push(["photo_choice", "Choose whether you consent to photos and videos being used"]);
    }
    if (n === "guardian") {
      if (!trim(v.guardian_name)) e.push(["guardian_name", "Enter your parent or guardian's name"]);
      if (!trim(v.guardian_phone)) e.push(["guardian_phone", "Enter your parent or guardian's phone number"]);
      if (!EMAIL.test(trim(v.guardian_email))) e.push(["guardian_email", "Enter your parent or guardian's email address"]);
      if (!v.guardian_consent) e.push(["guardian_consent", "A parent or guardian must consent to this entry"]);
    }
    if (n === "lifting") {
      if (ctx.settings.openipf_mode === "required" && !/^https:\/\/(www\.)?openipf\.org\/.+/i.test(trim(v.openipf_url))) e.push(["openipf_url", "Enter your OpenIPF profile link, starting https://www.openipf.org/"]);
      if (!v.event) e.push(["event", "Choose an event"]);
      if (!v.equipment) e.push(["equipment", "Choose your equipment"]);
      if (!v.weight_class_id || !allowedClasses().some(function (c) { return c.id === v.weight_class_id; })) e.push(["weight_class_id", "Choose your weight class"]);
      if (priceNow() === null && v.event && v.equipment) e.push(["event", "We could not work out a price. Please contact the entries team"]);
    }
    return e;
  }

  // ---- payment ---------------------------------------------------------------------------------
  function payload() {
    var o = { competition_id: ctx.comp.id, email: trim(v.email), full_name: trim(v.full_name), date_of_birth: dobISO(), sex: v.sex,
      bp_number: trim(v.bp_number), club: trim(v.club), division_id: v.division_id, instagram: trim(v.instagram).replace(/^@/, ""), event: v.event, equipment: v.equipment,
      weight_class_id: v.weight_class_id, openipf_url: trim(v.openipf_url),
      photo_ok: v.photo_choice === "yes", photo_opt_out: v.photo_choice === "never" };
    if (invite) o.invite = invite;
    if (offerInfo) o.offer = offer;
    if (v.discount_applied) o.discount_code = v.discount_applied.code;
    var ex = chosenExtras(); if (ex.length) o.extras = ex.map(function (x) { return x.option_id ? { id: x.id, option_id: x.option_id } : { id: x.id }; });
    if (ageOnDay() < 18) { o.guardian_name = trim(v.guardian_name); o.guardian_phone = trim(v.guardian_phone); o.guardian_email = trim(v.guardian_email); o.guardian_consent = !!v.guardian_consent; }
    return o;
  }
  function loadStripe() {
    return new Promise(function (resolve, reject) {
      if (window.Stripe) return resolve(window.Stripe);
      var s = document.createElement("script"); s.src = "https://js.stripe.com/v3/";
      s.onload = function () { resolve(window.Stripe); }; s.onerror = function () { reject(new Error("stripe.js did not load")); };
      document.head.appendChild(s);
    });
  }
  function pay(btn) {
    var err = document.getElementById("submit-error");
    err.hidden = true; btn.disabled = true; btn.textContent = "Holding your place…";
    Y.db().auth.getSession().then(function (s) {
      var token = s && s.data && s.data.session && s.data.session.access_token, body = payload();
      var headers = { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey || "" };
      if (preview && token) { headers.Authorization = "Bearer " + token; body.preview = true; }
      return fetch(CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/entry-checkout", { method: "POST", headers: headers, body: JSON.stringify(body) });
    }).then(function (res) { return res.json().catch(function () { return {}; }).then(function (b) { return { ok: res.ok, b: b }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.b.message || "Sorry, something went wrong. Please try again.");
        if (r.b.free) { location.href = "/entry-thanks?" + (r.b.slug ? "c=" + encodeURIComponent(r.b.slug) + "&" : "") + "entry=" + encodeURIComponent(r.b.entry_id); return; }
        return loadStripe().then(function (Stripe) {
          app.innerHTML = ""; app.appendChild(el("h2", null, "Pay " + pounds(r.b.price_pence)));
          app.appendChild(el("p", { class: "help" }, "Your place is held for " + ctx.settings.hold_minutes + " minutes. Please complete payment before then."));
          var clock = el("p", { class: "help", role: "timer" }); app.appendChild(clock);
          var endsAt = Date.now() + ctx.settings.hold_minutes * 60000;
          if (countdown) clearInterval(countdown);
          countdown = setInterval(function () {
            var left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
            if (left > 0) clock.textContent = "Time left to pay: " + Math.floor(left / 60) + ":" + ("0" + (left % 60)).slice(-2);
            else { clearInterval(countdown); clock.textContent = "Your held place has run out. If you have not paid, please start again. If you pay now and a place is still free, your entry will be confirmed; otherwise you will be refunded in full."; }
          }, 1000);
          var box = el("div", { id: "checkout" }); app.appendChild(box);
          return Stripe(r.b.publishable_key).initEmbeddedCheckout({ clientSecret: r.b.client_secret }).then(function (c) { c.mount(box); });
        });
      })
      .catch(function (e) {
        if (window.console) console.error(e);
        err.textContent = e.message || "Sorry, something went wrong. Please try again."; err.hidden = false; btn.disabled = false; btn.textContent = totalNow() === 0 ? "Confirm your entry" : "Continue to payment";
      });
  }
  function showDone() {
    app.innerHTML = ""; app.appendChild(el("div", { class: "success-panel", tabindex: "-1" }, el("div", { class: "tick", "aria-hidden": "true" }, "✓"),
      el("h2", { style: "margin-top:0" }, "You are entered"), el("p", null, "We have your entry. A confirmation email is on its way.")));
  }

  // ---- render ----------------------------------------------------------------------------------
  function render(keepFocus) {
    var active = keepFocus && document.activeElement && document.activeElement.id;
    clearErrors(); app.innerHTML = "";
    var list = stepList(), at = list.indexOf(step);
    if (at < 0) { step = "about"; at = 0; }
    app.appendChild(el("p", { class: "help" }, "Step " + (at + 1) + ": " + STEP_NAMES[step]));
    var last = step === "check";
    var body = step === "about" ? stepAbout() : step === "guardian" ? stepGuardian() : step === "lifting" ? stepLifting() : stepCheck();
    var form = el("form", { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault();
      if (last) return pay(form.querySelector("button[type=submit]"));
      var errs = validate(step); if (errs.length) return showErrors(errs);
      goStep(stepList()[stepList().indexOf(step) + 1]);
    } }, body,
      el("div", { class: "form-actions" },
        at > 0 ? el("button", { class: "btn btn-secondary", type: "button", onclick: function () { goStep(stepList()[stepList().indexOf(step) - 1]); } }, "Back") : null,
        el("button", { class: "btn btn-primary", type: "submit", id: last ? "pay-btn" : null }, last ? (totalNow() === 0 ? "Confirm your entry" : "Continue to payment") : "Continue")));
    app.appendChild(form);
    if (active) { var a = document.getElementById(active); if (a) a.focus(); }
  }


  // ---- the waiting list --------------------------------------------------------------------------------------
  function functionUrl(name) { return CFG.supabaseUrl.replace(/\/$/, "") + "/functions/v1/" + name; }
  function callFunction(name, body) {
    return Y.db().auth.getSession().then(function (s) {
      var token = s && s.data && s.data.session && s.data.session.access_token, headers = { "Content-Type": "application/json", apikey: CFG.supabaseAnonKey || "" };
      if (preview && token) { headers.Authorization = "Bearer " + token; body.preview = true; }
      return fetch(functionUrl(name), { method: "POST", headers: headers, body: JSON.stringify(body) });
    }).then(function (res) { return res.json().catch(function () { return {}; }).then(function (b) { return { ok: res.ok, b: b }; }); });
  }
  // Does the personal link from the offer email still work? Resolves to { ok, name, email, expires_at }.
  function checkOffer(compId) {
    if (!offer) return Promise.resolve({ ok: false });
    return callFunction("waitlist", { action: "offer", competition_id: compId, offer: offer }).then(function (r) { return r.b && r.b.ok ? r.b : { ok: false }; }, function () { return { ok: false }; });
  }
  // All places are taken: the waiting list opens by itself. Name and email, then we email when a place comes up.
  function showWaitlist(comp, settings, note) {
    title.textContent = comp.name + " is full";
    lede.textContent = Y.dateRange(comp.start_date, comp.end_date) + (comp.venue_name ? " at " + comp.venue_name : "");
    status.hidden = !preview; if (preview) status.innerHTML = "<p><strong>Preview.</strong> This competition is not published. You can try the waiting list because you are signed in to the site editor.</p>";
    var hours = settings.offer_window_hours || 48;
    var errBox = el("p", { class: "field-error", id: "wl-error", role: "alert", hidden: true });
    var btn = el("button", { class: "btn btn-primary", type: "submit" }, "Join the waiting list");
    var form = el("form", { novalidate: true, onsubmit: function (ev) {
      ev.preventDefault(); errBox.hidden = true;
      var name = trim(v.full_name), email = trim(v.email);
      if (!name) { errBox.textContent = "Enter your full name"; errBox.hidden = false; return document.getElementById("full_name").focus(); }
      if (!EMAIL.test(email)) { errBox.textContent = "Enter your email address in the right format, like name@example.com"; errBox.hidden = false; return document.getElementById("email").focus(); }
      btn.disabled = true; btn.textContent = "Joining…";
      callFunction("waitlist", { action: "join", competition_id: comp.id, full_name: name, email: email }).then(function (r) {
        if (!r.ok) throw new Error(r.b.message || "Sorry, something went wrong. Please try again.");
        app.replaceChildren(el("div", { class: "success-panel", tabindex: "-1" }, el("div", { class: "tick", "aria-hidden": "true" }, "✓"),
          el("h2", { style: "margin-top:0" }, r.b.already ? "You are already on the waiting list" : "You are on the waiting list"),
          el("p", null, "You are number " + r.b.position + " in the queue." + (r.b.already ? "" : " We have emailed you.")),
          el("p", null, "If a place becomes free we will email you a personal link, and you will have " + hours + " hours to use it. You do not need to do anything now.")));
      }).catch(function (e) { errBox.textContent = e.message; errBox.hidden = false; btn.disabled = false; btn.textContent = "Join the waiting list"; });
    } },
      note ? el("p", { class: "callout" }, note) : null,
      el("p", null, "All the places have been taken, but places do come up. Join the waiting list and we will email you a personal link if one does. You will then have " + hours + " hours to use it, and after that the place goes to the next person."),
      text("full_name", "Full name", { autocomplete: "name" }), text("email", "Email address", { type: "email", autocomplete: "email", max: 254, help: "We email you here if a place comes up." }),
      errBox, el("div", { class: "form-actions" }, btn));
    app.replaceChildren(form); app.hidden = false;
  }

  // ---- load ------------------------------------------------------------------------------------
  function stop(headline, html) {
    title.textContent = headline; lede.textContent = ""; app.hidden = true; status.hidden = false; status.innerHTML = html;
  }
  function init() {
    var q = new URLSearchParams(location.search), slug = q.get("c") || ""; invite = q.get("invite") || ""; offer = q.get("offer") || "";
    var db = Y.db();
    if (!db || !slug) return stop("Enter a competition", "<p>Choose a competition from the <a href='calendar.html'>calendar</a> to enter.</p>");
    var cols = "id,name,start_date,end_date,venue_name,slug,entry_url,waitlist_url,entry_opens,entry_closes";
    // The public sees published competitions only. A signed-in entries team member can also open an unpublished one
    // (a TEST competition) to try it. The payment function re-checks their login before allowing it.
    db.from("competitions_public").select(cols).eq("slug", slug).maybeSingle().then(function (r) {
      if (r.data) return { comp: r.data, preview: false };
      return db.from("competitions").select(cols + ",entry_method,entries_closed_manually").eq("slug", slug).maybeSingle().then(function (r2) {
        return r2.data ? { comp: r2.data, preview: true } : { comp: null };
      });
    }).then(function (found) {
      var comp = found.comp;
      if (!comp) return stop("Competition not found", "<p>We could not find that competition. Try the <a href='calendar.html'>calendar</a>.</p>");
      return Promise.all([
        found.preview ? Promise.resolve({ data: { entry_method: comp.entry_method, entries_closed_manually: comp.entries_closed_manually } }) : db.from("competition_entry_state").select("*").eq("competition_id", comp.id).maybeSingle(),
        db.from("entry_settings").select("*").eq("competition_id", comp.id).maybeSingle(),
        db.from("entry_stages").select("*").eq("competition_id", comp.id).order("opens_at"),
        db.from("price_rules").select("*").eq("competition_id", comp.id).order("sort_order"),
        db.from("weight_classes").select("*").eq("active", true).order("sort_order"),
        db.from("divisions").select("*").order("sort_order"),
        db.rpc("places_open", { c: comp.id }),
        db.from("clubs").select("name,region").eq("active", true).order("name"),
        db.from("addons").select("id,kind,name,description,price_pence,stock,sort_order,addon_options(id,label,sort_order)").eq("competition_id", comp.id).order("sort_order").order("name")
      ]).then(function (a) {
        var st = a[0].data, settings = a[1].data;
        if (st) st.places_left = a[6].data;
        preview = found.preview;
        title.textContent = "Enter " + comp.name;
        lede.textContent = Y.dateRange(comp.start_date, comp.end_date) + (comp.venue_name ? " at " + comp.venue_name : "");
        if (!st || !settings || st.entry_method !== "yne")
          return stop("Enter " + comp.name, "<p>Entries for this competition are not taken on this page." + (comp.entry_url ? " <a href='" + encodeURI(comp.entry_url) + "'>Enter here</a>." : "") + "</p>");
        var now = new Date();
        if (st.entries_closed_manually || (comp.entry_closes && new Date(comp.entry_closes) <= now)) return stop("Entries are closed", "<p>Entries for " + Y.el("span", null, comp.name).textContent + " are closed.</p>");
        var opensAt = comp.entry_opens ? new Date(comp.entry_opens) : null, priority = false;
        if (opensAt && opensAt > now) {
          var priorityFrom = new Date(opensAt.getTime() - (settings.priority_hours || 24) * 3600 * 1000), when = function (d) { return d.toLocaleString("en-GB", { timeZone: Y.TZ, dateStyle: "full", timeStyle: "short" }); };
          if (!(invite && now >= priorityFrom)) return stop("Entries are not open yet", "<p>Entries open on " + when(opensAt) + ".</p>" + (invite ? "<p>Your priority link works from " + when(priorityFrom) + ".</p>" : ""));
          priority = true;
        }
        var full = st.places_left < 1;
        return checkOffer(comp.id).then(function (o) {
          if (o.ok) offerInfo = o;
          // Full: the waiting list opens by itself (unless this person has a personal link that still works).
          if (full && !offerInfo) return showWaitlist(comp, settings, offer ? "That personal link has ended: the place was not taken up in time, or the link has already been used. You can join the waiting list again." : "");
          if (offerInfo) { v.full_name = offerInfo.name; v.email = offerInfo.email; }
          if (!(a[5].data || []).length) return stop("Enter " + comp.name, "<p>We could not load the list of federations, so entries cannot be taken just now. Please try again later or <a href='contact.html'>contact the entries team</a>.</p>");
          ctx = { comp: comp, settings: settings, rules: a[3].data || [], classes: a[4].data || [], divisions: a[5].data || [], clubs: a[7].data || [], extras: (a[8] && a[8].data) || [] };
          document.getElementById("hold-minutes").textContent = settings.hold_minutes;
          lede.textContent += offerInfo ? ". A place is being held for you." : ". " + st.places_left + (st.places_left === 1 ? " place" : " places") + " left.";
          if (priority) { status.hidden = false; status.innerHTML = "<p><strong>Priority entry.</strong> You are using a personal priority link. General entry opens on " + new Date(comp.entry_opens).toLocaleString("en-GB", { timeZone: Y.TZ, dateStyle: "full", timeStyle: "short" }) + ".</p>"; }
          if (offerInfo) { status.hidden = false; status.replaceChildren(el("p", null, el("strong", null, "A place is being held for you"), " until " + whenText(new Date(offerInfo.expires_at)) + ". Complete your entry and payment before then, or it goes to the next person on the waiting list.")); }
          if (preview) status.hidden = false, status.innerHTML = "<p><strong>Preview.</strong> This competition is not published. You can enter it because you are signed in to the site editor. Use Stripe test cards only.</p>";
          app.hidden = false; render();
        });
      });
    }).catch(function (e) { if (window.console) console.error(e); stop("Something went wrong", "<p>We could not load this page. Please try again or <a href='contact.html'>contact us</a>.</p>"); });
  }
  init();
})();
