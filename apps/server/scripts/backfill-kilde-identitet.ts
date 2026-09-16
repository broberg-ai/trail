/**
 * F275.1 AC#2 — giv de eksisterende kilder deres identitet.
 *
 * AC'et er skrevet som et TAL, ikke som «kør scriptet»: går antallet ikke fra
 * 0 til 66 på broberg.ai, er kortet ikke færdigt. Derfor printer den FØR og
 * EFTER, og den skelner tre tilstande frem for to:
 *
 *   fik en identitet        kilden bar en sourceUrl
 *   har ingen at få         en upload — hører til F275.6's fingeraftryk
 *   havde allerede en       idempotent, kørslen kan gentages
 *
 * Blandes de to midterste, ser rapporten bedre ud end virkeligheden: en upload
 * uden identitet ville tælle som «behandlet».
 *
 *   bun run apps/server/scripts/backfill-kilde-identitet.ts [--apply]
 *
 * UDEN --apply skriver den intet. Et backfill der kun kan køres for alvor er
 * et backfill man ikke tør køre.
 */
import { createLibsqlDatabase, documents } from '@trail/db';
import { identitetFraMetadata } from '@trail/shared';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';

const APPLY = process.argv.includes('--apply');
const DB = process.env.TRAIL_DB_PATH ?? '/data/broberg-ai/trail.db';

const trail = await createLibsqlDatabase({ path: DB });

const foer = await trail.db
  .select({ id: documents.id })
  .from(documents)
  .where(and(eq(documents.kind, 'source'), isNotNull(documents.sourceIdentity)))
  .all();

const kilder = await trail.db
  .select({ id: documents.id, filename: documents.filename, metadata: documents.metadata, nu: documents.sourceIdentity })
  .from(documents)
  .where(eq(documents.kind, 'source'))
  .all();

let fik = 0, ingenAtFaa = 0, havdeAllerede = 0;
for (const k of kilder) {
  if (k.nu) { havdeAllerede++; continue; }
  const id = identitetFraMetadata(k.metadata);
  if (!id) { ingenAtFaa++; continue; }
  if (APPLY) {
    await trail.db.update(documents).set({ sourceIdentity: id }).where(eq(documents.id, k.id)).run();
  }
  fik++;
}

const efter = await trail.db
  .select({ id: documents.id })
  .from(documents)
  .where(and(eq(documents.kind, 'source'), isNotNull(documents.sourceIdentity)))
  .all();

console.log(`base                : ${DB}`);
console.log(`kilder i alt        : ${kilder.length}`);
console.log(`FØR  med identitet  : ${foer.length}`);
console.log(`  fik en identitet  : ${fik}`);
console.log(`  havde allerede    : ${havdeAllerede}`);
console.log(`  har ingen at få   : ${ingenAtFaa}   (uploads — F275.6)`);
console.log(`EFTER med identitet : ${efter.length}${APPLY ? '' : '   (TØRLØB — intet skrevet)'}`);
await trail.close();
