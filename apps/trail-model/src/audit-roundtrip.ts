/**
 * F269.2 — mål integriteten kilde ↔ Neuron i produktionen, på kommando.
 *
 * HVORFOR DET IKKE ER NOK MED EN PRØVE I CI. Vagten i
 * `apps/server/src/test/source-roundtrip.test.ts` beskytter FREMTIDEN: den går
 * rød hvis skrivningen holder op med at stemple kilden. Den siger intet om
 * hvad vi allerede HAR — og det er dét spørgsmål der afgør om vi overhovedet
 * kan træne på materialet.
 *
 * DE TRE UDFALD, og de to sidste må aldrig blandes sammen:
 *
 *   HEL         kilden peger frem på Neuroner, og hver af dem peger tilbage
 *               på præcis den kilde. Brugbart træningsmateriale.
 *   FRAVÆRENDE  ingen af retningerne. Ærligt ukendt — kilden producerede
 *               bare ikke noget, eller sporet blev aldrig registreret.
 *   KNÆKKET     ÉN retning virker, den anden ikke. Det farlige udfald.
 *
 * HVORFOR KNÆKKET ER VÆRRE END FRAVÆRENDE. Et manglende par kan tælles og
 * lægges til side. Et knækket par ser HELT ud fra den side man tilfældigvis
 * kigger fra — og bruges det til træning, lærer modellen at et dokument
 * producerede noget det ikke producerede. Den fejl kan man ikke tælle sig ud
 * af bagefter, fordi den ikke ligner en fejl.
 *
 * HVORDAN DE TO RETNINGER MÅLES OVER API'ET:
 *   fremad    GET /documents/:id/derived      kilde → Neuroner
 *   tilbage   Neuronens egen `sourceIdentity` kolonne (F275.1: på en Neuron er
 *             den identiteten på den kilde den blev kompileret fra)
 *
 * READ-ONLY. Hvert kald er et GET.
 *
 *   set -a; . ./.env.local-ingest; set +a
 *   bun run apps/trail-model/src/audit-roundtrip.ts
 */
import {
  TENANTS,
  allDocuments,
  get,
  rowsOf,
  type DocumentRow,
  type KnowledgeBase,
} from './api.js';

interface DerivedNeuron {
  id: string;
  title: string | null;
}

interface Udfald {
  hel: number;
  fravaerende: number;
  knaekket: number;
  /** De knækkede navngives — et tal alene kan man ikke handle på. */
  detaljer: string[];
}

/**
 * Neuronens egen opfattelse af hvor den kom fra.
 *
 * Hentes fra dokumentlisten frem for pr. Neuron: listen bærer allerede
 * `sourceIdentity` (F275.1 tilføjede den netop fordi en måling PÅ listen ellers
 * svarede «0 med identitet» mens basen havde 229).
 */
async function neuronIdentiteter(tenant: string, kb: string): Promise<Map<string, string | null>> {
  const rows = await allDocuments(tenant, kb, 'wiki');
  return new Map(rows.map((r) => [r.id, (r as DocumentRow & { sourceIdentity?: string | null }).sourceIdentity ?? null]));
}

async function maalBrain(tenant: string, kb: KnowledgeBase): Promise<Udfald> {
  const kilder = await allDocuments(tenant, kb.slug, 'source');
  const identiteter = await neuronIdentiteter(tenant, kb.slug);
  const ud: Udfald = { hel: 0, fravaerende: 0, knaekket: 0, detaljer: [] };

  for (const kilde of kilder) {
    const kildeIdentitet =
      (kilde as DocumentRow & { sourceIdentity?: string | null }).sourceIdentity ?? null;

    const derived = await get<{ neurons?: DerivedNeuron[] }>(
      tenant,
      `/api/v1/documents/${kilde.id}/derived`,
    );
    const fremad = derived.neurons ?? [];

    if (fremad.length === 0) {
      ud.fravaerende++;
      continue;
    }

    // Fremad-opslaget fandt noget. Peger hver eneste af dem tilbage på DENNE
    // kilde? En enkelt der ikke gør, gør hele parret knækket — vi kan ikke
    // bruge halvdelen af et par.
    const uenige = fremad.filter((n) => {
      const tilbage = identiteter.get(n.id);
      // Kender kilden ikke sin egen identitet, kan rundturen ikke afgøres.
      // Det tælles som knækket frem for som helt: «kunne ikke efterprøves» må
      // ikke se ud som «efterprøvet og i orden».
      if (!kildeIdentitet) return true;
      return tilbage !== kildeIdentitet;
    });

    if (uenige.length === 0) {
      ud.hel++;
    } else {
      ud.knaekket++;
      ud.detaljer.push(
        `${kb.slug}/${kilde.filename}: ${uenige.length} af ${fremad.length} Neuroner peger ikke tilbage` +
          (kildeIdentitet ? '' : ' (kilden har selv ingen identitet)'),
      );
    }
  }
  return ud;
}

async function main(): Promise<void> {
  const w = (s: string, n: number) => s.padEnd(n).slice(0, n);
  console.log('');
  console.log(`${w('brain', 32)}${'hel'.padStart(7)}${'knækket'.padStart(10)}${'fraværende'.padStart(13)}`);
  console.log('-'.repeat(62));

  const total: Udfald = { hel: 0, fravaerende: 0, knaekket: 0, detaljer: [] };

  for (const tenant of TENANTS) {
    for (const kb of rowsOf<KnowledgeBase>(await get(tenant, '/api/v1/knowledge-bases'))) {
      const u = await maalBrain(tenant, kb);
      if (u.hel + u.knaekket + u.fravaerende === 0) continue;
      console.log(
        `${w(`${tenant}/${kb.slug}`, 32)}${String(u.hel).padStart(7)}${String(u.knaekket).padStart(10)}${String(u.fravaerende).padStart(13)}`,
      );
      total.hel += u.hel;
      total.knaekket += u.knaekket;
      total.fravaerende += u.fravaerende;
      total.detaljer.push(...u.detaljer);
    }
  }

  console.log('-'.repeat(62));
  console.log(
    `${w('I ALT', 32)}${String(total.hel).padStart(7)}${String(total.knaekket).padStart(10)}${String(total.fravaerende).padStart(13)}`,
  );

  console.log(`\nBRUGBART TRÆNINGSMATERIALE: ${total.hel} kilder med hel rundtur.`);
  if (total.knaekket > 0) {
    console.log(`\n${total.knaekket} KNÆKKEDE — én retning virker, den anden ikke:`);
    for (const d of total.detaljer.slice(0, 20)) console.log(`  ${d}`);
    if (total.detaljer.length > 20) console.log(`  … og ${total.detaljer.length - 20} mere`);
  } else {
    console.log('\nIngen knækkede par. Hver kilde der peger frem, peges tilbage på.');
  }
  console.log(
    `\n${total.fravaerende} fraværende — kilder uden spor. Ærligt ukendt, ikke en fejl:` +
      ' enten producerede de intet, eller de er ældre end F269.1 (10/9 2026).',
  );

  // Exit-koden er MÅLINGENS, ikke kørslens: et knækket par er et fund der
  // skal kunne stoppe noget, hvis værktøjet en dag sættes i en port.
  if (total.knaekket > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
