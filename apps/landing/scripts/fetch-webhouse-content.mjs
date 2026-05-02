/**
 * Fetches published content from webhouse.app and writes it to the local
 * content/ directory so build.ts can read it.
 *
 * Usage:
 *   WEBHOUSE_JWT=<jwt> node scripts/fetch-webhouse-content.mjs
 *
 * Env:
 *   WEBHOUSE_URL     - CMS base URL (default: https://webhouse.app)
 *   WEBHOUSE_JWT     - CMS session JWT
 *   WEBHOUSE_ORG     - Org ID (default: broberg-ai)
 *   WEBHOUSE_SITE    - Site ID (default: trail)
 *   CONTENT_DIR      - Output dir (default: content)
 */
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.WEBHOUSE_URL ?? "https://webhouse.app";
const JWT = process.env.WEBHOUSE_JWT;
const ORG = process.env.WEBHOUSE_ORG ?? "broberg-ai";
const SITE = process.env.WEBHOUSE_SITE ?? "trail";
const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", process.env.CONTENT_DIR ?? "content");

if (!JWT) {
  console.error("WEBHOUSE_JWT is required");
  process.exit(1);
}

const COOKIE = `cms-session=${JWT}; cms-active-org=${ORG}; cms-active-site=${SITE}`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Cookie: COOKIE },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
}

async function fetchCollection(name) {
  const dir = join(CONTENT_DIR, name);
  mkdirSync(dir, { recursive: true });

  const data = await fetchJson(`/api/cms/${name}?limit=500`);
  const docs = data.documents ?? data.docs ?? [];
  let count = 0;

  for (const doc of docs) {
    if (doc.status !== "published" && doc.status !== undefined) continue;
    const slug = doc.slug ?? doc.id;
    const outPath = join(dir, `${slug}.json`);
    writeFileSync(outPath, JSON.stringify(doc, null, 2));
    count++;
  }
  console.log(`  ${name}: ${count} documents`);
}

// Get collections from site config
const siteConfig = await fetchJson("/api/admin/site-config");
const config = await fetchJson("/api/admin/cms-config");
const collections = config.collections?.map(c => c.name) ?? ["posts", "pages", "categories", "global"];

console.log(`Fetching from ${BASE} (org: ${ORG}, site: ${SITE})`);
console.log(`Collections: ${collections.join(", ")}`);

for (const col of collections) {
  try {
    await fetchCollection(col);
  } catch (err) {
    console.warn(`  ${col}: SKIP (${err.message})`);
  }
}

console.log("Content fetch complete →", CONTENT_DIR);
