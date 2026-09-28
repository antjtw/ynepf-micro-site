/* ==========================================================================
   contentful.js — minimal Content Delivery API client.

   Deliberately dependency-free (uses Node's built-in fetch, Node 18+) to
   match the rest of this repo's zero-npm-install build tooling. Fetches
   every entry of a content type, resolving linked entries/assets from the
   response's `includes` block one level deep.
   ========================================================================== */

function isConfigured() {
  return Boolean(process.env.CONTENTFUL_SPACE_ID && process.env.CONTENTFUL_DELIVERY_TOKEN);
}

function resolveLink(link, includes) {
  if (!link || link.sys?.type !== "Link") return link;
  const bucket = link.sys.linkType === "Asset" ? includes.assets : includes.entries;
  return bucket.get(link.sys.id) || null;
}

// Walk an entry's fields and replace Link objects with the real entry/asset,
// so callers never have to deal with Contentful's sys.type indirection.
function resolveFields(fields, includes) {
  const resolved = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (Array.isArray(value)) {
      resolved[key] = value.map((v) => (v?.sys?.type === "Link" ? resolveLink(v, includes) : v));
    } else if (value?.sys?.type === "Link") {
      resolved[key] = resolveLink(value, includes);
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

async function fetchAllEntries(contentType, { order } = {}) {
  if (!isConfigured()) {
    throw new Error(
      "Contentful is not configured. Set CONTENTFUL_SPACE_ID and CONTENTFUL_DELIVERY_TOKEN."
    );
  }

  const spaceId = process.env.CONTENTFUL_SPACE_ID;
  const environment = process.env.CONTENTFUL_ENVIRONMENT || "master";
  const token = process.env.CONTENTFUL_DELIVERY_TOKEN;

  const entries = [];
  const assetIndex = new Map();
  const entryIndex = new Map();
  const limit = 100;
  let skip = 0;
  let total = Infinity;

  while (skip < total) {
    const url = new URL(
      `https://cdn.contentful.com/spaces/${spaceId}/environments/${environment}/entries`
    );
    url.searchParams.set("content_type", contentType);
    url.searchParams.set("include", "2");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("skip", String(skip));
    if (order) url.searchParams.set("order", order);

    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(
        `Contentful request failed (${res.status}) for content type "${contentType}": ${await res.text()}`
      );
    }
    const body = await res.json();

    for (const asset of body.includes?.Asset || []) assetIndex.set(asset.sys.id, asset);
    for (const entry of body.includes?.Entry || []) entryIndex.set(entry.sys.id, entry);
    for (const entry of body.items) entries.push(entry);

    total = body.total;
    skip += limit;
  }

  const includes = { assets: assetIndex, entries: entryIndex };
  return entries.map((entry) => ({
    id: entry.sys.id,
    fields: resolveFields(entry.fields, includes),
  }));
}

module.exports = { isConfigured, fetchAllEntries };
