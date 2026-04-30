/**
 * F33 Phase 1B.2 — seed control.db with Sanne's existing tenant and the
 * two user accounts (Sanne owner + Christian admin) so they can log in
 * via magic-link without going through the F172 onboarding flow that
 * doesn't yet exist.
 *
 * Idempotent: re-runs INSERT OR IGNORE so safe to invoke at boot or via
 * `fly ssh console -C "bun run /app/apps/admin-server/scripts/seed-control-db.ts"`.
 */

import { db, schema } from '../src/db.js';

const ORG_ID = 'org-sanne-andersen';
const TENANT_ID = 't-sanne-andersen';
const USER_SANNE = 'u-sanne';
const USER_CB = 'u-cb-webhouse';

async function seed() {
  console.log('[seed] inserting org, tenant, users, engine binding…');

  await db
    .insert(schema.organizations)
    .values({ id: ORG_ID, slug: 'sanne-andersen', name: 'Sanne Andersen' })
    .onConflictDoNothing();

  await db
    .insert(schema.controlTenants)
    .values({
      id: TENANT_ID,
      organizationId: ORG_ID,
      slug: 'sanne-andersen',
      name: 'Sanne Andersen',
      language: 'da',
    })
    .onConflictDoNothing();

  await db
    .insert(schema.controlUsers)
    .values([
      {
        id: USER_SANNE,
        organizationId: ORG_ID,
        email: 'mail@sanneandersen.dk',
        name: 'Sanne Andersen',
        onboarded: false,
      },
      {
        id: USER_CB,
        organizationId: ORG_ID,
        email: 'cb@webhouse.dk',
        name: 'Christian Broberg',
        onboarded: false,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(schema.tenantEngines)
    .values({
      tenantId: TENANT_ID,
      engineId: 'engine-001',
      engineUrl: 'https://engine-001.trailmem.com',
      engineInternalUrl: 'http://trail-engine-001.flycast:8080',
      provisionedAt: '2026-04-29T14:04:00Z',
      notes: 'F33 Phase 1A — first engine, hosts Sanne directly.',
    })
    .onConflictDoNothing();

  console.log('[seed] done.');
  process.exit(0);
}

await seed();
