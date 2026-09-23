/**
 * F286.10 — every active Neuron title per brain, so build_compile.py can prove
 * that each [[link]] in the compile dataset points at a title that exists.
 *
 *   bun run src/export-titles.ts <brain-slug> [<brain-slug> …]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { allDocuments, requireKey } from './api.js';

requireKey();
for (const slug of process.argv.slice(2)) {
  const rows = await allDocuments('broberg-ai', slug, 'wiki');
  const titles = [...new Set(rows.map((r) => r.title ?? r.filename.replace(/\.md$/, '')))].sort();
  writeFileSync(join(import.meta.dir, '..', 'data', `titles-${slug}.json`), JSON.stringify(titles, null, 1) + '\n');
  console.log(`${slug}: ${titles.length} titler`);
}
