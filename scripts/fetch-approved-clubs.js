#!/usr/bin/env node
/* ==========================================================================
   fetch-approved-clubs.js — scrape the English Powerlifting Association's
   affiliated clubs page and write assets/js/clubs-data.js plus a local copy
   of every club logo in assets/img/clubs/.

   The EPA site is built on Wix. The club list is a Wix CMS dataset, and the
   full set of records is embedded in the page as JSON (the
   "wix-warmup-data" script), so no browser is needed.

   Run by .github/workflows/approved-clubs.yml on a schedule. Safe to run
   locally too:
     node scripts/fetch-approved-clubs.js
     node scripts/fetch-approved-clubs.js --from-file page.html --skip-images
   ========================================================================== */
const https = require("https");
const fs = require("fs");
const path = require("path");

const PAGE_URL = "https://www.englishpowerlifting.co.uk/affiliated-clubs";
const MEDIA_BASE = "https://static.wixstatic.com/media/";

const ROOT = path.join(__dirname, "..");
const OUT_FILE = path.join(ROOT, "assets", "js", "clubs-data.js");
const LOGO_DIR = path.join(ROOT, "assets", "img", "clubs");
const LOGO_WEB_PATH = "assets/img/clubs/";

// How long a removed club stays listed under "Recently removed".
const REMOVED_RETENTION_DAYS = 180;
// Refuse to write if the club count drops by more than this share in one run.
// A big drop is far more likely to be a broken scrape than a mass exodus.
const MAX_DROP_RATIO = 0.25;

const args = process.argv.slice(2);
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : args[i + 1];
};
const FROM_FILE = argValue("--from-file");
const SKIP_IMAGES = args.includes("--skip-images");
const FORCE = args.includes("--force");

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; YNEPF-approved-clubs/1.0)" } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Unexpected status ${res.statusCode} fetching ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Wix rich text -> plain paragraphs separated by blank lines.
function richTextToPlain(html) {
  if (!html) return "";
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h[1-6]|div)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/​/g, "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim())
    .filter(Boolean)
    .join("\n\n");
}

function slugify(s) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The contact block holds a person's name, email and phone. We deliberately
// keep only the club's website; contact details stay on the EPA site.
function extractWebsite(contact) {
  if (!contact) return "";
  // Only look after the "Web & Postal Address" label, so the email domain isn't mistaken for a site.
  const section = contact.split(/Web\s*(?:&|and)\s*Postal Address:?/i)[1] || "";
  // A "www." with a space in it (a typo on the EPA page) is rejected below rather
  // than letting the bare-domain match pick up its tail.
  const m =
    section.match(/\bhttps?:\/\/[^\s,;)]+/i) ||
    section.match(/\bwww\.[^\s,;)]+/i) ||
    section.match(/(?<![@\w.-])[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:co\.uk|org\.uk|com|uk|net|org|london|io|co)\b(?:\/[^\s,;)]*)?/i);
  if (!m) return "";
  let url = m[0].replace(/[.,]+$/, "");
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (!host.includes(".")) return ""; // e.g. a typo'd "www.sapphire gym.co.uk"
  } catch (e) {
    return "";
  }
  return url;
}

function wixDate(v) {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (v.$date) return v.$date;
  return null;
}

// Pull the dataset records, in the order the EPA page displays them.
function parseClubs(html) {
  const m = html.match(/<script type="application\/json" id="wix-warmup-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("wix-warmup-data script not found; the page structure has changed");
  const warmup = JSON.parse(m[1]);
  const store = warmup.appsWarmupData && warmup.appsWarmupData.dataBinding && warmup.appsWarmupData.dataBinding.dataStore;
  if (!store) throw new Error("Wix data store not found in warmup data");

  const byId = {};
  for (const coll of Object.values(store.recordsByCollectionId || {})) {
    for (const [id, rec] of Object.entries(coll)) byId[id] = rec;
  }

  // Pick the dataset whose records look like clubs (title + rich-text blurb).
  let best = null;
  for (const info of Object.values(store.recordInfosByDatasetId || {})) {
    const ids = (info.itemIds || []).filter((id) => byId[id] && "title" in byId[id] && "wxRchTxt_sTxt0" in byId[id]);
    if (!best || ids.length > best.ids.length) best = { ids, total: info.datasetSize && info.datasetSize.total };
  }
  if (!best || !best.ids.length) throw new Error("No club records found in the Wix data store");
  if (best.total && best.total > best.ids.length) {
    throw new Error(`Page embeds ${best.ids.length} of ${best.total} clubs; the dataset is paginated and needs a second fetch`);
  }

  return best.ids.map((id) => {
    const r = byId[id];
    const name = decodeEntities(String(r.title || "")).replace(/\s+/g, " ").trim();
    // Records carry the image as "wix:image://v1/<uri>/<name>#..." or as { uri }.
    let logoUri = "";
    if (typeof r.image === "string") {
      const im = r.image.match(/^wix:image:\/\/v1\/([^/#]+)/);
      if (im) logoUri = im[1];
    } else if (r.image && r.image.uri) {
      logoUri = r.image.uri;
    }
    return {
      id,
      name,
      description: richTextToPlain(r.wxRchTxt_sTxt0),
      website: extractWebsite(r.Strng_sTxt1),
      logoUri,
      addedToEpa: wixDate(r._createdDate),
    };
  }).filter((c) => c.name);
}

function loadPrevious() {
  if (!fs.existsSync(OUT_FILE)) return null;
  const src = fs.readFileSync(OUT_FILE, "utf8");
  const m = src.match(/window\.APPROVED_CLUBS_DATA = ([\s\S]*);\s*$/);
  return m ? JSON.parse(m[1]) : null;
}

async function downloadLogo(club, previous) {
  if (!club.logoUri) return "";
  const ext = (path.extname(club.logoUri).toLowerCase().match(/^\.(png|jpe?g|gif|webp|svg)$/) || [".png"])[0];
  const file = club.slug + ext.replace(".jpeg", ".jpg");
  const dest = path.join(LOGO_DIR, file);

  // Same source image as last time and the file is still here: skip the download.
  if (previous && previous.logoUri === club.logoUri && previous.logo === LOGO_WEB_PATH + file && fs.existsSync(dest)) {
    return previous.logo;
  }
  if (SKIP_IMAGES) return previous && previous.logo ? previous.logo : "";

  // Ask Wix for a resized copy so we don't ship 2000px PNGs; fall back to the original.
  const original = MEDIA_BASE + club.logoUri;
  const resized = ext === ".svg" || ext === ".gif" ? original : `${original}/v1/fit/w_400,h_400,q_90/${file}`;
  let buf;
  try {
    buf = await get(resized);
  } catch (e) {
    buf = await get(original);
  }
  fs.writeFileSync(dest, buf);
  return LOGO_WEB_PATH + file;
}

async function main() {
  const html = FROM_FILE ? fs.readFileSync(FROM_FILE, "utf8") : (await get(PAGE_URL)).toString("utf8");
  const scraped = parseClubs(html);
  const previous = loadPrevious();
  const prevClubs = previous ? previous.clubs : [];
  const prevById = Object.fromEntries(prevClubs.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);

  if (prevClubs.length && !FORCE && scraped.length < prevClubs.length * (1 - MAX_DROP_RATIO)) {
    throw new Error(
      `Scrape found ${scraped.length} clubs but ${prevClubs.length} were listed before. ` +
        "Refusing to overwrite; check the page, then rerun with --force if the drop is real."
    );
  }

  // Unique slugs, so two clubs with similar names never share a logo file.
  const used = new Set();
  for (const c of scraped) {
    let slug = slugify(c.name) || c.id;
    for (let n = 2; used.has(slug); n++) slug = `${slugify(c.name)}-${n}`;
    used.add(slug);
    c.slug = slug;
  }

  fs.mkdirSync(LOGO_DIR, { recursive: true });
  const clubs = [];
  for (const c of scraped) {
    const prev = prevById[c.id];
    let logo = "";
    try {
      logo = await downloadLogo(c, prev);
    } catch (e) {
      console.warn(`Logo download failed for ${c.name}: ${e.message}`);
      logo = prev && prev.logo ? prev.logo : "";
    }
    clubs.push({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      website: c.website,
      logo,
      logoUri: c.logoUri,
      addedToEpa: c.addedToEpa,
      // First time this scraper saw the club. Empty on the very first run, so
      // the initial import isn't all flagged as "new".
      firstSeen: prev ? prev.firstSeen : previous ? today : "",
    });
  }

  // Clubs that have dropped off the EPA list since the last run.
  const currentIds = new Set(clubs.map((c) => c.id));
  const cutoff = new Date(Date.now() - REMOVED_RETENTION_DAYS * 864e5).toISOString().slice(0, 10);
  const removed = [
    ...prevClubs.filter((c) => !currentIds.has(c.id)).map((c) => ({ id: c.id, name: c.name, removedOn: today })),
    ...((previous && previous.removed) || []).filter((r) => !currentIds.has(r.id) && r.removedOn >= cutoff),
  ];

  // Delete logo files no current club points at.
  const keep = new Set(clubs.map((c) => path.basename(c.logo)).filter(Boolean));
  for (const f of fs.readdirSync(LOGO_DIR)) {
    if (!keep.has(f) && !SKIP_IMAGES) fs.unlinkSync(path.join(LOGO_DIR, f));
  }

  const payload = { source: PAGE_URL, checkedAt: new Date().toISOString(), clubs, removed };
  const out =
    "// Generated by scripts/fetch-approved-clubs.js — do not edit by hand.\n" +
    "// Source: " + PAGE_URL + "\n" +
    "window.APPROVED_CLUBS_DATA = " +
    JSON.stringify(payload, null, 2) +
    ";\n";
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out, "utf8");

  const added = clubs.filter((c) => !prevById[c.id]);
  console.log(`Wrote ${clubs.length} clubs to ${path.relative(process.cwd(), OUT_FILE)}`);
  if (previous) {
    console.log(`New since last run: ${added.length ? added.map((c) => c.name).join(", ") : "none"}`);
    console.log(`Removed since last run: ${removed.filter((r) => r.removedOn === today).map((r) => r.name).join(", ") || "none"}`);
  }
  const noLogo = clubs.filter((c) => !c.logo).map((c) => c.name);
  if (noLogo.length) console.log(`No logo: ${noLogo.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
