/**
 * Verify image-FTS over `document_images.vision_description` end-to-end.
 *
 * Run against the LOCAL trail.db (Sanne KB has the most vision-described
 * images on disk locally — same data lives in prod via the engine
 * migration history). Probes:
 *
 *   - Multi-word queries ("gul blomst", "ingefær rod") return targeted hits
 *   - Single-word "fod" matches anatomy + foot images
 *   - Empty/no-match queries ("Prøv igen") return at most 1 partial-token
 *     match — confirms FTS5 default tokenizer OR-mode, document the
 *     edge case so future cc sessions don't chase a ghost
 *
 * Why this script exists: 2026-05-21 Christian was seeing the admin chat
 * panel return zero images even after the engine returned an `images`
 * array. The race was on the SPA side (turn.images getting reload-clobbered
 * by setActiveId-triggered fetch). This script confirms the FTS layer is
 * sound so future bug hunts can rule it out in 5 seconds instead of
 * re-deriving via `flyctl ssh`.
 *
 * Usage:
 *   bun run apps/server/scripts/verify-chat-image-fts.ts
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

const DB_PATH =
  process.env.TRAIL_DB_PATH ?? '/Users/cb/Apps/broberg/trail/data/trail.db';

if (!existsSync(DB_PATH)) {
  console.error(`✗ DB not found: ${DB_PATH}`);
  console.error(`  Set TRAIL_DB_PATH to override (e.g. for an engine-side probe)`);
  process.exit(2);
}

const db = new Database(DB_PATH, { readonly: true });

const QUERIES: ReadonlyArray<{ q: string; expect: 'many' | 'few' | 'none' }> = [
  { q: 'gul blomst', expect: 'many' },
  { q: 'gule blomster', expect: 'many' },
  { q: 'ingefær', expect: 'few' },
  { q: 'ingefær rod', expect: 'few' },
  { q: 'fod', expect: 'many' },
  { q: 'menneskefod', expect: 'many' }, // FTS tokenizer splits compound
  { q: 'Prøv', expect: 'none' },
  { q: 'Prøv igen', expect: 'none' }, // ideal — both tokens absent in alt-text
];

let failures = 0;
for (const { q, expect } of QUERIES) {
  try {
    const rows = db
      .query(
        `SELECT di.vision_description
           FROM document_images_fts fts
           JOIN document_images di ON di.rowid = fts.rowid
          WHERE fts.vision_description MATCH ?
          LIMIT 10`,
      )
      .all(q) as Array<{ vision_description: string }>;
    const n = rows.length;
    const tier = n === 0 ? 'none' : n <= 2 ? 'few' : 'many';
    const ok = tier === expect;
    if (!ok) failures++;
    const status = ok ? '✓' : '✗';
    console.log(`${status} Q="${q}" → ${n} hit(s) [${tier}, expected ${expect}]`);
    for (const r of rows.slice(0, 2)) {
      console.log(`    · ${r.vision_description?.slice(0, 80)}`);
    }
  } catch (err) {
    failures++;
    console.log(`✗ Q="${q}" → ERROR: ${(err as Error).message.slice(0, 100)}`);
  }
}

console.log('');
if (failures === 0) {
  console.log('✓ All FTS probes match expected tier.');
} else {
  console.log(`✗ ${failures}/${QUERIES.length} probes diverged from expected tier.`);
  process.exit(1);
}
