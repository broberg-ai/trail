/**
 * F269.2 — integriteten mellem en kilde og dens Neuroner, BEGGE VEJE.
 *
 * HVORFOR DENNE PRØVE FINDES. F269.1 lukkede et hul hvor en Neuron ikke kunne
 * pege tilbage på den kilde den kom fra. Hullet stod åbent i tre måneder og
 * kostede 256 kilder som træningsmateriale — indholdet findes, forbindelsen
 * gør ikke, og den kan ikke genskabes bagud.
 *
 * DEN VAGT DER FANDTES BAGEFTER STOD PÅ DEN FORKERTE AKSE. `kilde-peger.test.ts`
 * prøver AFLÆSNINGEN — at vi tolker pegepinden rigtigt når den er der. Holder
 * skrivningen op med at stemple den, består alle de prøver stadig, fordi der
 * ikke er noget at aflæse. Det er nøjagtig samme fejlform som hullet selv:
 * instrumentet er skarpt, det peger bare den forkerte vej.
 *
 * SÅ DENNE PRØVE KALDER DEN ÆGTE SKRIVNING. `ingestWrite` er den funktion
 * ingest, MCP'en og wiki-write faktisk går igennem. En prøve der byggede sin
 * egen metadata ville bevise at efterligningen virker — og det er præcis den
 * fælde `propagation-integration.test.ts` står i (dens `compile()` skriver
 * `sourceDocumentId` selv).
 *
 * OG DEN LÆSER TILBAGE FRA BASEN, ikke fra returværdien. En funktion der
 * rapporterer hvad den forsøgte, og en række der bærer det, er to forskellige
 * påstande.
 */
import { test, expect, beforeEach, describe } from 'bun:test';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import {
  createLibsqlDatabase,
  tenants,
  users,
  knowledgeBases,
  documents,
  queueCandidates,
  wikiEvents,
} from '@trail/db';
import { and, eq } from 'drizzle-orm';
import { ingestWrite, type CandidateQueueContext } from '@trail/core';
import { laesKildePeger } from '../routes/documents.js';

const T = 't-rt';
const U = 'u-rt';
const KB = 'kb-rt';
const KILDE = 'src-rt-1';
const ANDEN_KILDE = 'src-rt-2';

let trail: Awaited<ReturnType<typeof createLibsqlDatabase>>;

/**
 * Den ÆGTE kontekst ingest kører med. `sourceDocumentId` udelades når den ikke
 * er kendt — det er hele designet, og derfor den tilstand der skal kunne
 * skelnes fra en tom værdi.
 */
function ctx(sourceDocumentId?: string): CandidateQueueContext {
  return {
    trail,
    tenantId: T,
    tenantName: 'Roundtrip',
    userId: U,
    connector: 'mcp:claude-code',
    ingestJobId: null,
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
    defaultKbId: KB,
  };
}

/** Kandidaternes metadata, læst TILBAGE fra basen — aldrig fra returværdien. */
async function kandidaterFraBasen() {
  return trail.db
    .select({ id: queueCandidates.id, kind: queueCandidates.kind, metadata: queueCandidates.metadata })
    .from(queueCandidates)
    .where(eq(queueCandidates.tenantId, T))
    .all();
}

/** Den rå metadata-nøgle, så «fraværende», «null» og «tom» kan skelnes. */
async function raaMetadata(): Promise<Record<string, unknown>> {
  const [k] = await kandidaterFraBasen();
  return JSON.parse(k?.metadata ?? '{}') as Record<string, unknown>;
}

beforeEach(async () => {
  const p = join(process.env.TMPDIR ?? '/tmp', `rt-${process.pid}-${Math.random().toString(36).slice(2, 8)}.db`);
  for (const f of [p, `${p}-wal`, `${p}-shm`]) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* frisk base */
    }
  }
  trail = await createLibsqlDatabase({ path: p });
  await trail.runMigrations();
  await trail.db.insert(tenants).values({ id: T, slug: 'rt', name: 'RT', plan: 'hobby' }).run();
  await trail.db
    .insert(users)
    .values({ id: U, tenantId: T, email: 'rt@local.trail', displayName: 'RT', role: 'owner', onboarded: true })
    .run();
  await trail.db
    .insert(knowledgeBases)
    .values({ id: KB, tenantId: T, createdBy: U, name: 'RT', slug: KB, language: 'da' })
    .run();
  for (const id of [KILDE, ANDEN_KILDE]) {
    await trail.db
      .insert(documents)
      .values({
        id,
        tenantId: T,
        userId: U,
        knowledgeBaseId: KB,
        kind: 'source',
        path: '/sources/',
        filename: `${id}.md`,
        content: 'kildetekst',
        fileType: 'md',
        sourceIdentity: `path:${id}`,
      })
      .run();
  }
  // En side at opdatere, så str_replace og append har noget at arbejde på.
  await trail.db
    .insert(documents)
    .values({
      id: 'side',
      tenantId: T,
      userId: U,
      knowledgeBaseId: KB,
      kind: 'wiki',
      path: '/neurons/',
      filename: 'side.md',
      title: 'Side',
      content: 'FØR',
      fileType: 'md',
    })
    .run();
});

// ── Stemplingen: alle tre kaldesteder, hver for sig ─────────────────────────
//
// Hvert for sig, ikke samlet. Hullet opstod netop fordi én vej var dækket og
// en anden ikke var, og en samlet prøve ville være grøn så længe ÉN af de tre
// stadig stemplede.

describe('skrive-stien stempler kilden', () => {
  test('create — værdien står i basen, streng lighed', async () => {
    const r = await ingestWrite(ctx(KILDE), {
      command: 'create',
      title: 'En Neuron',
      content: '# En Neuron\n\nnoget indhold',
      path: '/neurons/',
    });
    expect(r.ok).toBe(true);

    const md = await raaMetadata();
    expect(md.op).toBe('create');
    expect(md.sourceDocumentId).toBe(KILDE);
  });

  test('str_replace — værdien står i basen', async () => {
    const r = await ingestWrite(ctx(KILDE), {
      command: 'str_replace',
      title: '/neurons/side.md',
      old_text: 'FØR',
      new_text: 'EFTER',
    });
    expect(r.ok).toBe(true);

    const md = await raaMetadata();
    expect(md.op).toBe('update');
    expect(md.sourceDocumentId).toBe(KILDE);
  });

  test('append — værdien står i basen', async () => {
    const r = await ingestWrite(ctx(KILDE), {
      command: 'append',
      title: '/neurons/side.md',
      content: 'mere tekst',
    });
    expect(r.ok).toBe(true);

    const md = await raaMetadata();
    expect(md.op).toBe('update');
    expect(md.sourceDocumentId).toBe(KILDE);
  });

  test('NEGATIV KONTROL — uden kendt kilde er nøglen FRAVÆRENDE, ikke null og ikke tom', async () => {
    const r = await ingestWrite(ctx(), {
      command: 'create',
      title: 'Uden kilde',
      content: '# Uden kilde\n\nskrevet direkte',
      path: '/neurons/',
    });
    expect(r.ok).toBe(true);

    const md = await raaMetadata();
    // De tre tilstande må aldrig blandes sammen. `null` ville sige «der er
    // ingen kilde»; fravær siger «vi ved det ikke». Det var netop den
    // forveksling der fik hullet til at ligne dækning i tre måneder.
    expect('sourceDocumentId' in md).toBe(false);
    expect(md.sourceDocumentId).toBeUndefined();
  });
});

// ── Rundturen ───────────────────────────────────────────────────────────────

/** Fremad: kilde → kandidater → wiki_events → Neuroner. Produktets egen gåtur. */
async function fremad(kildeId: string): Promise<string[]> {
  const kandidater = await kandidaterFraBasen();
  const traf = kandidater.filter((k) => laesKildePeger(k.metadata).sourceDocumentId === kildeId);
  const ud: string[] = [];
  for (const k of traf) {
    const ev = await trail.db
      .select({ documentId: wikiEvents.documentId })
      .from(wikiEvents)
      .where(and(eq(wikiEvents.tenantId, T), eq(wikiEvents.sourceCandidateId, k.id)))
      .all();
    for (const e of ev) ud.push(e.documentId);
  }
  return [...new Set(ud)].sort();
}

/** Tilbage: Neuron → den hændelse der skabte den → kandidaten → kilden. */
async function tilbage(neuronId: string): Promise<string | null> {
  const ev = await trail.db
    .select({ sourceCandidateId: wikiEvents.sourceCandidateId })
    .from(wikiEvents)
    .where(and(eq(wikiEvents.tenantId, T), eq(wikiEvents.documentId, neuronId)))
    .all();
  for (const e of ev) {
    if (!e.sourceCandidateId) continue;
    const k = await trail.db
      .select({ metadata: queueCandidates.metadata })
      .from(queueCandidates)
      .where(and(eq(queueCandidates.tenantId, T), eq(queueCandidates.id, e.sourceCandidateId)))
      .get();
    const peger = laesKildePeger(k?.metadata);
    if (peger.sourceDocumentId) return peger.sourceDocumentId;
  }
  return null;
}

describe('rundturen kilde ↔ Neuron', () => {
  test('fremad og tilbage giver SAMME svar', async () => {
    await ingestWrite(ctx(KILDE), {
      command: 'create',
      title: 'Rundtur',
      content: '# Rundtur\n\nindhold',
      path: '/neurons/',
    });

    const neuroner = await fremad(KILDE);
    expect(neuroner.length).toBeGreaterThan(0);

    // Hver eneste Neuron fremad-opslaget nævner, skal pege tilbage på PRÆCIS
    // den kilde. Ikke en anden, ikke ingen.
    for (const n of neuroner) {
      expect({ neuron: n, kilde: await tilbage(n) }).toEqual({ neuron: n, kilde: KILDE });
    }
  });

  test('NEGATIV KONTROL — en HALV kæde opdages, selv om den ser hel ud fra den ene side', async () => {
    await ingestWrite(ctx(KILDE), {
      command: 'create',
      title: 'Halv',
      content: '# Halv\n\nindhold',
      path: '/neurons/',
    });
    const neuroner = await fremad(KILDE);
    expect(neuroner.length).toBeGreaterThan(0);

    // Knæk kæden bagud ved at lade kandidaten pege på en ANDEN kilde. Fremad
    // fra ANDEN_KILDE finder nu Neuronen — men tilbage fra Neuronen svarer
    // ANDEN_KILDE, mens den oprindelige kilde stadig tror den ejer den.
    const [k] = await kandidaterFraBasen();
    const md = JSON.parse(k!.metadata ?? '{}') as Record<string, unknown>;
    md.sourceDocumentId = ANDEN_KILDE;
    await trail.db
      .update(queueCandidates)
      .set({ metadata: JSON.stringify(md) })
      .where(eq(queueCandidates.id, k!.id))
      .run();

    // Fra den ene side ser det stadig ud som et helt par.
    const efter = await fremad(ANDEN_KILDE);
    expect(efter).toEqual(neuroner);

    // Men rundturen holder ikke, og DET er hvad der skal kunne opdages: en
    // Neuron der hævder at stamme fra et dokument den ikke stammer fra, er
    // værre end et manglende par — et manglende par kan tælles.
    for (const n of neuroner) {
      expect(await tilbage(n)).not.toBe(KILDE);
    }
  });
});
