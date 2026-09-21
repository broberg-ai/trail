/**
 * F222.8 AC#4 — bevis at sidedelingen ikke tabte noget.
 *
 * KORTETS KRAV, ordret: «for en KB med flere sider end sidestørrelsen giver hver
 * berørt scanning PRÆCIS samme mængde dokumenter og samme resultat som før
 * rettelsen. Sammenligningen er streng lighed på antal OG på de id'er der blev
 * set — ikke 'den kørte igennem'.»
 *
 * HVORFOR DET IKKE KAN AFGØRES VED AT LÆSE KODEN. En markør-baseret gennemgang
 * taber rækker TAVST når markør-kolonnen ikke giver en stabil total orden, eller
 * når `where`-klausulen og markøren trækker hver sin vej. Resultatet er ikke en
 * fejl — det er et kortere svar. Præcis den fejlform hele kortet handler om, nu
 * i rettelsen frem for i fejlen.
 *
 * HVORFOR EN PÅTVUNGET LILLE SIDE. Med produktionens standard (500) ville et
 * testsæt skulle være enormt før der overhovedet BLEV sidedelt — og en
 * sidedeling der aldrig kører, består enhver prøve. Derfor tvinges pageSize=7
 * over 250 rækker: 36 sider, så markøren skal virke 35 gange i træk.
 *
 *   bun run apps/server/scripts/verify-f222-8-paging.ts
 *
 * Exit 0 = hver scanning så præcis de samme id'er, i samme rækkefølge, som en
 * ubegrænset forespørgsel på de samme data. Exit 1 = den navngiver hvad der
 * afveg.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectPaged,
  createLibsqlDatabase,
  documents,
  knowledgeBases,
  tenants,
  users,
  type TrailDatabase,
} from '@trail/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import { detectFadedHeuristics } from '@trail/core';
import { HEURISTIC_PATH } from '@trail/shared';

const T = 't-verify';
const U = 'u-verify';
const KB = 'kb-verify';

/**
 * ROWS er sat af den ÆGTE funktion, ikke af bekvemmelighed.
 *
 * `detectFadedHeuristics` tager ingen sidestørrelse — den kører produktionens
 * standard på 500. Første udgave af dette script seedede 250 rækker, hvoraf 125
 * matchede heuristik-stien, og meldte GRØNT: funktionen så alle 125. Men den
 * havde aldrig SIDEDELT, for 125 < 500. En grøn linje der beviste ingenting om
 * det eneste den skulle bevise.
 *
 * Derfor 1.400: halvdelen ligger på heuristik-stien, altså 700 rækker og TO
 * sider gennem den ægte funktion. `PAGE` gælder kun den kontrol hvor vi selv
 * må vælge den, og er sat absurd lavt så markøren skal virke mange gange.
 */
const ROWS = 1400;
const PAGE = 7;

interface Check {
  name: string;
  /** Hvad kaldestedet FAKTISK gør — kaldt for rigtigt, ikke efterlignet. */
  ran: 'ægte funktion' | 'kaldestedets egen forespørgsel';
  baseline: string[];
  paged: string[];
}

function report(c: Check): boolean {
  const sameCount = c.baseline.length === c.paged.length;
  // STRENG lighed på selve id-sekvensen, ikke på længden og ikke på et sæt.
  // En markør der bytter om på to rækker giver samme antal og samme sæt.
  const sameOrder = c.baseline.every((id, i) => c.paged[i] === id);
  const ok = sameCount && sameOrder;
  console.log(
    `${ok ? '  OK  ' : ' FEJL '} ${c.name}  (${c.ran})\n` +
      `         ubegrænset ${c.baseline.length} rækker · sidedelt ${c.paged.length} rækker` +
      (ok
        ? ' · identisk sekvens'
        : sameCount
          ? ` · SAMME ANTAL, FORSKELLIG RÆKKEFØLGE — første afvigelse ved ${c.baseline.findIndex((id, i) => c.paged[i] !== id)}`
          : ` · ${Math.abs(c.baseline.length - c.paged.length)} rækker ${c.paged.length < c.baseline.length ? 'TABT' : 'for mange'}`),
  );
  return ok;
}

async function seed(trail: TrailDatabase): Promise<void> {
  await trail.db.insert(tenants).values({ id: T, slug: 'verify', name: 'Verify', plan: 'hobby' }).run();
  await trail.db
    .insert(users)
    .values({ id: U, tenantId: T, email: 'verify@local.trail', displayName: 'V', role: 'owner', onboarded: true })
    .run();
  await trail.db
    .insert(knowledgeBases)
    .values({ id: KB, tenantId: T, createdBy: U, slug: 'verify', name: 'Verify' })
    .run();

  for (let i = 0; i < ROWS; i++) {
    // Id'erne sorterer IKKE som indsættelsesrækkefølgen (uuid-agtige), så en
    // gennemgang der antog «i den rækkefølge de kom» ville afvige her.
    const id = `doc-${(i * 7919) % 100000}-${i}`;
    await trail.db
      .insert(documents)
      .values({
        id,
        tenantId: T,
        knowledgeBaseId: KB,
        userId: U,
        kind: 'wiki',
        filename: `n-${i}.md`,
        title: `Neuron ${i}`,
        // Heuristik-stien, så faded-heuristics faktisk har noget at se på.
        path: i % 2 === 0 ? HEURISTIC_PATH : '/neurons/concepts/',
        fileType: 'md',
        status: 'ready',
        content: `# Neuron ${i}\n\n${'indhold '.repeat(40)}`,
      })
      .run();
  }
}

/** Den ubegrænsede form — præcis den forespørgsel kortet fandt 12 af. */
async function unbounded(trail: TrailDatabase, pathFilter?: string): Promise<string[]> {
  // Når der filtreres på sti, gengives detectFadedHeuristics' EGNE prædikater
  // (kind, archived, path) — ellers ville basen tælle rækker funktionen aldrig
  // ser, og en «uenighed» ville være min sammenligning der var forkert frem for
  // sidedelingen der tabte noget.
  const rows = await trail.db
    .select({ id: documents.id })
    .from(documents)
    .where(
      pathFilter
        ? and(
            eq(documents.knowledgeBaseId, KB),
            eq(documents.tenantId, T),
            eq(documents.kind, 'wiki'),
            eq(documents.archived, false),
            eq(documents.path, pathFilter),
          )
        : eq(documents.knowledgeBaseId, KB),
    )
    .orderBy(asc(documents.id))
    .all();
  return rows.map((r) => r.id);
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'f222-8-'));
  const trail = await createLibsqlDatabase({ path: join(dir, 'verify.db'), tenantId: T });
  try {
    await trail.runMigrations();
    await seed(trail);

    const checks: Check[] = [];

    // 1. GENNEMLØBEREN SELV, over kaldestedernes fælles forespørgselsform.
    //    Alle syv migrerede steder bruger samme markør (documents.id) og samme
    //    orden (asc(documents.id)) — målt i kilden — så denne ene kontrol
    //    dækker den form de deler.
    checks.push({
      name: 'collectPaged over hele KB’en',
      ran: 'kaldestedets egen forespørgsel',
      baseline: await unbounded(trail),
      paged: (
        await collectPaged(
          (cursor, limit) =>
            trail.db
              .select({ id: documents.id })
              .from(documents)
              .where(
                and(eq(documents.knowledgeBaseId, KB), ...(cursor ? [gt(documents.id, cursor)] : [])),
              )
              .orderBy(asc(documents.id))
              .limit(limit)
              .all(),
          (r) => r.id,
          { pageSize: PAGE },
        )
      ).map((r) => r.id),
    });

    // 2. DEN ÆGTE FUNKTION, kaldt for rigtigt. faded-heuristics er det
    //    kaldested kortets egen tekst fejlagtigt fritog som «kun metadata» —
    //    derfor netop den. Den eksponerer ikke id-listen, kun sit eget
    //    `scanned`, så denne sammenligning er på ANTAL og siges sådan frem for
    //    at blive præsenteret som sekvens-lighed.
    const heuristicRows = await unbounded(trail, HEURISTIC_PATH);
    const faded = await detectFadedHeuristics(trail, KB, T);
    const fadedOk = faded.scanned === heuristicRows.length;
    console.log(
      `${fadedOk ? '  OK  ' : ' FEJL '} detectFadedHeuristics  (ægte funktion)\n` +
        `         ubegrænset ${heuristicRows.length} rækker · funktionen rapporterer scanned=${faded.scanned}` +
        `${fadedOk ? ' · enige' : ' · UENIGE'}\n` +
        `         (id-listen er ikke eksponeret, så dette er lighed på ANTAL — ikke på sekvens)`,
    );

    // NEGATIV KONTROL. En sammenligning der aldrig er set fejle, kan være
    // sand fordi den ikke måler noget. Fjern én række af de sidedelte og kræv
    // at rapporten bliver RØD.
    const sabotaged: Check = {
      ...checks[0]!,
      name: 'NEGATIV KONTROL — én række fjernet med vilje',
      paged: checks[0]!.paged.slice(0, -1),
    };
    console.log('');
    const caught = !report(sabotaged);
    console.log(
      caught
        ? '         ↑ forventet FEJL. Sammenligningen kan altså blive rød.'
        : '         ↑ PROBLEM: sammenligningen blev grøn på et sæt der mangler en række.',
    );
    console.log('');

    const allOk = checks.map(report).every(Boolean) && fadedOk && caught;
    console.log(
      `\n${ROWS} rækker, sidestørrelse ${PAGE} → ${Math.ceil(ROWS / PAGE)} sider. ` +
        `Markøren skulle virke ${Math.ceil(ROWS / PAGE) - 1} gange i træk.`,
    );
    if (!allOk) {
      console.error('\nMINDST ÉN SCANNING AFVEG. Sidedelingen er ikke adfærds-neutral.');
      process.exit(1);
    }
    console.log('Alle scanninger så præcis det samme som en ubegrænset forespørgsel.');
  } finally {
    await trail.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) await main();
