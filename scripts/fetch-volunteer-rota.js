#!/usr/bin/env node
/* ==========================================================================
   fetch-volunteer-rota.js — pull the published volunteer rota sheet and
   write assets/js/volunteer-rota-data.js as a plain static data file.

   The sheet is a hand-formatted roster, not a clean table: role name sits
   in column B (index 1), and up to two named columns of people sit in
   columns D and G (indices 3 and 6) — e.g. Session 1 / Session 2, or
   Set up / Tear down. A row where column B is exactly "Role" starts a new
   block, with the block's column title(s) in D/G on that same row and the
   arrival/weigh-in time on the next non-blank row. Each block is flattened
   into one "rota" per column so the page can show Session 1, Session 2,
   Prime Time, Set up and Tear down as separate single-column tabs.

   Instagram URLs aren't in a fixed column either — any cell near a name
   that contains "instagram.com" is picked up as that person's profile link.

   Run by .github/workflows/lifting-order.yml on a schedule. Safe to run
   locally too: `node scripts/fetch-volunteer-rota.js`.
   ========================================================================== */
const https = require("https");
const fs = require("fs");
const path = require("path");

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSALdLwOIW_nM6XEddf4Jp6AGuTJoVEtRLmswvp3kZu7UeqvKYbVRxOmaela5Ii_A/pub?gid=766643133&single=true&output=csv";

const OUT_FILE = path.join(__dirname, "..", "assets", "js", "volunteer-rota-data.js");

// Rows that are notices/footnotes rather than role rows, matched against column B.
const NOTE_PATTERNS = [
  /please arrive/i,
  /^\*/,
  /no longer able to volunteer/i,
  /marked with a tick/i,
];

// Stopgap fixes for names that are unclear in the sheet itself (e.g. "Dempsey??").
// Remove an entry once the source sheet is corrected.
const NAME_CORRECTIONS = {
  "Dempsey??": "Matt Dempsey",
};

function fetchCsv(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirects > 0) {
          res.resume();
          resolve(fetchCsv(res.headers.location, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Unexpected status ${res.statusCode} fetching sheet`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

// Minimal RFC 4180 CSV parser: handles quoted fields, embedded commas/newlines/"" escapes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore; \n below ends the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function cell(row, i) {
  return (row[i] || "").trim();
}

function isNote(roleText) {
  return NOTE_PATTERNS.some((re) => re.test(roleText));
}

const IG_URL_PATTERN = /instagram\.com/i;

function normalizeUrl(u) {
  if (!u) return "";
  return /^https?:\/\//i.test(u) ? u : "https://" + u;
}

// Finds the nearest Instagram URL to a name column within [minIndex, maxIndex],
// since the sheet isn't a clean fixed-column table — the URL just needs to sit
// somewhere near the name it belongs to, not in one exact column.
function findInstagramUrl(row, nameIndex, minIndex, maxIndex) {
  var best = "";
  var bestDist = Infinity;
  for (var i = minIndex; i <= maxIndex && i < row.length; i++) {
    var v = cell(row, i);
    if (v && IG_URL_PATTERN.test(v)) {
      var dist = Math.abs(i - nameIndex);
      if (dist < bestDist) {
        bestDist = dist;
        best = v;
      }
    }
  }
  return normalizeUrl(best);
}

// Parses the raw grid into blocks, each with 1-2 named columns and role rows.
function parseBlocks(rows) {
  const blocks = [];
  var current = null;

  rows.forEach((row) => {
    const role = cell(row, 1);
    const left = cell(row, 3);
    const right = cell(row, 6);

    if (role === "Role") {
      current = { columns: [], rows: [] };
      if (left) current.columns.push({ title: left, time: "" });
      if (right) current.columns.push({ title: right, time: "" });
      blocks.push(current);
      return;
    }

    if (!current) return;

    const timeLike = /weigh-in|arrive by/i.test(left) || /weigh-in|arrive by/i.test(right);
    if (timeLike && current.rows.length === 0) {
      if (current.columns[0]) current.columns[0].time = left;
      if (current.columns[1]) current.columns[1].time = right;
      return;
    }

    if (!role || isNote(role)) return;

    var igLeft = findInstagramUrl(row, 3, 0, 4);
    var igRight = findInstagramUrl(row, 6, 5, row.length - 1);
    current.rows.push({ role: role, values: [left, right], instagrams: [igLeft, igRight] });
  });

  return blocks;
}

// Flattens each block into one rota per column (Session 1, Session 2, ...).
function flattenRotas(blocks) {
  const rotas = [];
  blocks.forEach((block) => {
    block.columns.forEach((col, colIndex) => {
      rotas.push({
        title: col.title,
        time: col.time,
        roles: block.rows.map((r) => {
          var name = r.values[colIndex] || "";
          return {
            role: r.role,
            name: NAME_CORRECTIONS[name] || name,
            instagram: (r.instagrams && r.instagrams[colIndex]) || "",
          };
        }),
      });
    });
  });
  return rotas;
}

async function main() {
  const csv = await fetchCsv(CSV_URL);
  const rows = parseCsv(csv);
  const blocks = parseBlocks(rows);
  const rotas = flattenRotas(blocks);

  if (!rotas.length) throw new Error("No volunteer rota blocks found in sheet");

  const payload = { generatedAt: new Date().toISOString(), rotas: rotas };
  const out =
    "// Generated by scripts/fetch-volunteer-rota.js — do not edit by hand.\n" +
    "// Source: published Google Sheet CSV (see CSV_URL in that script).\n" +
    "window.VOLUNTEER_ROTA_DATA = " +
    JSON.stringify(payload, null, 2) +
    ";\n";

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, out, "utf8");
  console.log(`Wrote ${rotas.length} rotas to ${path.relative(process.cwd(), OUT_FILE)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
