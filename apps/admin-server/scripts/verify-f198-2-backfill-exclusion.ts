/**
 * F198.2 — BEVIS: uddeler boot-backfillen stadig kunde-tenants til Lens?
 *
 * Kør:  rm -f /tmp/trail-f198-2.db* && \
 *       TRAIL_ADMIN_CONTROL_DB=/tmp/trail-f198-2.db \
 *       bun run apps/admin-server/scripts/verify-f198-2-backfill-exclusion.ts
 *
 * REPRODUCERER DEN ÆGTE RÆKKEFØLGE, ikke en bekvem en. I prod findes
 * Lens-brugeren fra en tidligere mint; DERNÆST booter en ny udgivelse og
 * kører backfillen. Kørte prøven kun migrations FØR minten, ville den bestå
 * uanset — brugeren ville ikke have eksisteret da uddelingen fandt sted.
 *
 * NEGATIV KONTROL indbygget: en ALMINDELIG bruger i samme organisation SKAL
 * få begge tenants. Uden den ville prøven også bestå hvis backfillen var
 * holdt op med at virke overhovedet — «ingen fik noget» og «Lens fik intet»
 * ville se ens ud.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';
import { mintLensCookie, LENS_EMAIL } from '../src/lens-session.js';

let fejl = 0;
function hævd(msg: string, faktisk: unknown, forventet: unknown) {
  const ok = faktisk === forventet;
  if (!ok) fejl++;
  console.log(`  ${ok ? '✓' : '✗'} ${msg}\n      faktisk=${JSON.stringify(faktisk)} forventet=${JSON.stringify(forventet)}`);
}

console.log('\n=== F198.2 backfill-undtagelse ===\n');
await runMigrations();

// VORES organisation, med BÅDE vores egen tenant og en kundes i den. Det er
// præcis konstellationen der gav fejlen: fd-aalborg ligger i org-broberg-ai,
// så JOIN'en på organization_id nåede den.
const ORG = 'org-x';
await db.insert(schema.organizations).values({ id: ORG, slug: 'broberg-ai', name: 'broberg-ai' }).run();
await db.insert(schema.controlTenants).values({ id: 't-os', organizationId: ORG, slug: 'broberg-ai', name: 'os' }).run();
await db.insert(schema.controlTenants).values({ id: 't-kunde', organizationId: ORG, slug: 'en-kunde', name: 'En Kunde' }).run();
await db
  .insert(schema.controlUsers)
  .values({ id: 'usr-alm', organizationId: ORG, email: 'medarbejder@webhouse.dk', name: 'Alm', onboarded: true })
  .run();

// 1) Lens-brugeren opstår ved en mint — som i prod.
await mintLensCookie({ principal: LENS_EMAIL, host: 'app.trailmem.com', secure: true, ttlMs: 6e5, expiresAt: Date.now() + 6e5 });

// 2) Næste udgivelse booter. DET er øjeblikket der uddelte adgangen.
await runMigrations();

async function tenantsFor(email: string): Promise<string[]> {
  const u = await db.query.controlUsers.findFirst({ where: eq(schema.controlUsers.email, email) });
  if (!u) return [];
  const rows = await db
    .select({ slug: schema.controlTenants.slug })
    .from(schema.controlMemberships)
    .innerJoin(schema.controlTenants, eq(schema.controlTenants.id, schema.controlMemberships.tenantId))
    .where(eq(schema.controlMemberships.userId, u.id))
    .all();
  return rows.map((r) => r.slug).sort();
}

const lens = await tenantsFor(LENS_EMAIL);
const alm = await tenantsFor('medarbejder@webhouse.dk');

console.log('Efter boot:');
hævd('Lens er KUN medlem af vores egen tenant', lens.join(','), 'broberg-ai');
// Negativ kontrol — backfillen skal stadig virke for alle andre.
hævd('en almindelig bruger får begge tenants (backfillen lever)', alm.join(','), 'broberg-ai,en-kunde');

console.log(fejl === 0 ? '\nBESTÅET\n' : `\n${fejl} FEJLET\n`);
process.exit(fejl === 0 ? 0 : 1);
