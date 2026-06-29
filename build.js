#!/usr/bin/env node
/* ==========================================================================
   build.js — refresh inlined partials and produce a deployable dist/.

   The header and footer live once in assets/partials/. They are inlined
   directly into every page between marker comments:
     <!-- @partial:header start --> ... <!-- @partial:header end -->
   so the source pages are fully self-contained and work when opened from
   disk (file://) with no server and no JavaScript needed for the nav.

   Running this script:
     1. re-inlines the current partials into every source page (idempotent),
        so editing a partial updates all pages, then
     2. copies the whole site into dist/ for deployment.

   Usage:  node build.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

const header = fs.readFileSync(path.join(ROOT, "assets/partials/header.html"), "utf8").trim();
const footer = fs.readFileSync(path.join(ROOT, "assets/partials/footer.html"), "utf8").trim();

const HDR = ["<!-- @partial:header start -->", "<!-- @partial:header end -->"];
const FTR = ["<!-- @partial:footer start -->", "<!-- @partial:footer end -->"];

const pages = [
  "index.html", "committee.html", "calendar.html", "volunteering.html",
  "initiatives.html", "faqs.html", "rules.html",
  "initiatives/entry-fees.html", "initiatives/yne-worlds.html",
  "rules/the-lifts.html",
  "rules/categories.html",
  "rules/squat.html",
  "rules/bench-press.html",
  "rules/deadlift.html",
  "rules/failed-lift.html",
  "rules/classic-kit.html",
  "rules/equipped-kit.html",
  "rules/belts-wraps-sleeves.html",
  "rules/shoes-socks-headwear.html",
  "rules/general-kit-rules.html",
  "rules/equipment-check.html",
  "rules/platform-and-bar.html",
  "rules/discs.html",
  "rules/racks-bench-clocks.html",
  "rules/weigh-in.html",
  "rules/round-system.html",
  "rules/loading-errors.html",
  "rules/conduct-and-safety.html",
  "rules/gl-points.html",
  "rules/roles.html",
  "rules/referee-signals.html",
  "rules/referee-roles.html",
  "rules/become-a-referee.html",
  "rules/the-jury.html",
  "rules/technical-committee.html",
  "rules/world-records.html",
  "rules/coach-responsibilities.html",
  "rules/team-competition.html",
  "rules/anti-doping.html",
];

// Depth-relative prefix: number of "/" in the page path = how many ../ needed.
function rootFor(rel) {
  const depth = rel.split("/").length - 1;
  return "../".repeat(depth);
}

function setActive(html, block) {
  const m = html.match(/<body[^>]*data-page="([^"]+)"/);
  if (!m) return block;
  const key = m[1];
  return block.replace(
    new RegExp('(<a href="[^"]+" data-nav="' + key + '")', "g"),
    '$1 aria-current="page"'
  );
}

function reinline(html, root) {
  const hdr = header.replace(/\{\{ROOT\}\}/g, root);
  const hb = HDR[0] + "\n" + setActive(html, hdr) + "\n" + HDR[1];
  const fb = FTR[0] + "\n" + footer + "\n" + FTR[1];
  const hRe = new RegExp(HDR[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + HDR[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const fRe = new RegExp(FTR[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?" + FTR[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (html.includes("<!--#include header-->")) html = html.replace("<!--#include header-->", hb);
  else if (hRe.test(html)) html = html.replace(hRe, hb);
  if (html.includes("<!--#include footer-->")) html = html.replace("<!--#include footer-->", fb);
  else if (fRe.test(html)) html = html.replace(fRe, fb);
  return html;
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.name === "dist" || e.name === "node_modules") continue;
    const s = path.join(from, e.name), d = path.join(to, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 1. Re-inline partials into source pages
pages.forEach((rel) => {
  const p = path.join(ROOT, rel);
  fs.writeFileSync(p, reinline(fs.readFileSync(p, "utf8"), rootFor(rel)), "utf8");
  console.log("inlined", rel);
});

// 2. Build dist/
fs.rmSync(DIST, { recursive: true, force: true });
copyDir(ROOT, DIST);
console.log("\nBuilt dist/. Deploy the dist/ folder, or open any page directly — both work.");
