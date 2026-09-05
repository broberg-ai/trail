/**
 * F253.1 — dæknings-invarianten mod en LOKAL DATABASEFIL.
 *
 * ⚠️  BRUG `GET /api/v1/history/coverage` I STEDET, medmindre du VED at den
 * tenant du måler ligger på en fil. Efter F222.3 serveres broberg-ai,
 * sanne-andersen og fd-aalborg fra sqld på trail-db-001 (se TRAIL_DB_REMOTE),
 * mens den gamle fil bliver liggende på motorens disk — med vilje, indtil
 * ejeren har verificeret flytningen.
 *
 * MÅLT 6/9 2026, og det er derfor advarslen står her: dette script blev kørt
 * mod /data/broberg-ai/trail.db, fandt 2 revner, reparerede dem og læste 0
 * tilbage. Hele rapporten var internt konsistent — og handlede om en kopi
 * ingen bruger. Den samme fil fik mig til at melde 37 dubletter i en base
 * hvor der er nul. EN FILSTI ER ET GÆT PÅ HVOR DATA ER; ruten er et opslag.
 *
 *   bun run apps/server/scripts/verify-event-log-coverage.ts <db-sti>
 *   bun run apps/server/scripts/verify-event-log-coverage.ts <db-sti> --repair
 *
 * Uden --repair rører den ingenting. Rapporten skelner de to invarianter, fordi
 * de siger forskellige ting: indholds-drift er den seneste skrivning der sprang
 * loggen over, version-drift er en skrivning der ALDRIG blev logget — også en
 * der senere blev overskrevet, og som indholds-tjekket derfor ikke kan se.
 */
import { createLibsqlDatabase } from '@trail/db';
import { auditEventLogCoverage, repairEventLogCoverage } from '@trail/core';

const path = process.argv[2];
const repair = process.argv.includes('--repair');
if (!path) {
  console.error('brug: bun run verify-event-log-coverage.ts <db-sti> [--repair]');
  process.exit(1);
}

const trail = await createLibsqlDatabase({ path });
const tenants = (await trail.execute(`SELECT id, slug FROM tenants`)).rows as Array<{ id: string; slug: string }>;

let totalGaps = 0;
for (const t of tenants) {
  const r = await auditEventLogCoverage(trail, t.id);
  console.log(`\n── ${t.slug}  ·  ${r.neurons} Neuroner`);
  console.log(`   uden historik overhovedet : ${r.withoutHistory}`);
  console.log(`   revner                    : ${r.gaps.length}`);
  for (const g of r.gaps) {
    const grunde = [g.contentDrift ? 'indhold≠nyeste kopi' : null, g.versionDrift ? `version ${g.version} > ${g.eventCount} hændelser` : null]
      .filter(Boolean).join(' · ');
    console.log(`     ${g.documentId}  ${g.path ?? ''}${g.filename ?? ''}  — ${grunde}`);
  }
  totalGaps += r.gaps.length;

  if (repair && r.gaps.length > 0) {
    const n = await repairEventLogCoverage(trail, t.id, r.gaps);
    // LÆS TILBAGE — ikke reparationens returtal, men basens tilstand bagefter.
    const efter = await auditEventLogCoverage(trail, t.id);
    console.log(`   → ${n} indhentnings-hændelser lagt; revner efter: ${efter.gaps.length}`);
    if (!efter.intact) {
      console.error('   ✗ IKKE lukket — se rækkerne ovenfor');
      process.exitCode = 1;
    }
  }
}

console.log(`\n${repair ? 'REPARERET' : 'KUN MÅLT'} — ${totalGaps} revne(r) på tværs af ${tenants.length} tenant(s)`);
if (!repair && totalGaps > 0) process.exitCode = 1;
