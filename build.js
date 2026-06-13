#!/usr/bin/env node
/* ==========================================================================
   build.js — inline shared partials into each page.
   Source pages contain placeholders:  <!--#include header-->  <!--#include footer-->
   This stamps the canonical partials from assets/partials/ into a /dist build,
   so the published pages are fully static (no client fetch, no FOUC, works on
   file://). Re-run after editing any page or partial:  node build.js
   ========================================================================== */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

const header = fs.readFileSync(path.join(ROOT, "assets/partials/header.html"), "utf8");
const footer = fs.readFileSync(path.join(ROOT, "assets/partials/footer.html"), "utf8");

// Pages to build (relative paths preserved into dist/)
const pages = [
  "index.html",
  "committee.html",
  "calendar.html",
  "volunteering.html",
  "initiatives.html",
  "faqs.html",
  "initiatives/entry-fees.html",
  "initiatives/yne-worlds.html",
];

function setActiveNav(html, page) {
  // page key matches data-page on <body>
  const m = html.match(/<body[^>]*data-page="([^"]+)"/);
  if (!m) return html;
  const key = m[1];
  // Add aria-current to the matching nav link in the now-inlined header.
  return html.replace(
    new RegExp('(<a href="[^"]+" data-nav="' + key + '")', "g"),
    '$1 aria-current="page"'
  );
}

function build() {
  // Reset dist
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // Copy assets verbatim
  copyDir(path.join(ROOT, "assets"), path.join(DIST, "assets"));

  pages.forEach((rel) => {
    const src = path.join(ROOT, rel);
    let html = fs.readFileSync(src, "utf8");
    html = html.replace(/<!--#include header-->/g, header.trim());
    html = html.replace(/<!--#include footer-->/g, footer.trim());
    html = setActiveNav(html, rel);
    // Static build no longer needs the include loader; leave tabs.js intact.
    html = html.replace(
      /\s*<script src="\/assets\/js\/includes\.js"[^>]*><\/script>/g,
      ""
    );
    const out = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, "utf8");
    console.log("built", rel);
  });
  console.log("\nDone. Serve the dist/ folder, e.g.:  npx serve dist");
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const s = path.join(from, entry.name);
    const d = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

build();
