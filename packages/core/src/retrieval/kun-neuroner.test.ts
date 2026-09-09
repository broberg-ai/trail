/**
 * F254.7 — kun Neuroner embeddes.
 *
 * Ejeren 6/9: «Kildemateriale er KUN til at skabe neuronerne — neuronerne ER
 * hjernen og det er den der skal indekseres og aldrig kilderne.»
 *
 * Prøven læser den ÆGTE SQL, ikke min gengivelse af den. En prøve på en streng
 * jeg selv har skrevet ned, beviser at strengen står der — ikke at forespørgslen
 * filtrerer.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const vectors = readFileSync(new URL('./vectors.ts', import.meta.url), 'utf8');
const indexer = readFileSync(
  new URL('../../../../apps/server/src/services/indexer.ts', import.meta.url),
  'utf8',
);

/**
 * Uddrag kilden fra `efter` og frem til NÆSTE top-niveau-erklæring.
 *
 * F265.4 — var før et fast vindue på 900 tegn. Det brød på KORREKT kode: da
 * loadVectors fik sideinddeling, rykkede `d.kind = 'wiki'` til tegn 1.111, og
 * prøven gik rød på en funktion der stadig havde sit filter.
 *
 * Et fast byte-vindue måler afstand, ikke tilstedeværelse — og det fejler i
 * begge retninger: for kort, og korrekt kode dømmes; for langt, og filteret
 * kan findes i den NÆSTE funktion og dømmes til stede hvor det mangler.
 * Grænsen skal være funktionens egen, ikke et tal.
 */
function sql(kilde: string, efter: string): string {
  const i = kilde.indexOf(efter);
  expect(i).toBeGreaterThan(-1);
  const rest = kilde.slice(i + efter.length);
  const slut = rest.search(/\nexport (async )?(function|const) /);
  return (efter + (slut === -1 ? rest : rest.slice(0, slut))).replace(/\s+/g, ' ');
}

test('LÆSESIDEN UDELADER KILDER — ellers dukker råmateriale op i søgningen', () => {
  expect(sql(vectors, 'export async function loadVectors')).toContain("d.kind = 'wiki'");
});

test('DÆKNINGSMÅLEREN TÆLLER NEURONER I NÆVNEREN', () => {
  // Uden dette kunne målingen aldrig nå 100 %, fordi kilder med vilje er uden
  // vektor — og en måler der pr. konstruktion aldrig bliver grøn, bliver
  // ignoreret indenfor en uge.
  expect(sql(vectors, '(SELECT COUNT(*) FROM document_chunks c')).toContain("d.kind = 'wiki') AS chunks");
});

test('FEJEREN EMBEDDER KUN NEURONER', () => {
  expect(sql(indexer, 'FROM document_chunks c')).toContain("d.kind = 'wiki'");
});

test('FEJEREN RYDDER KILDE-VEKTORER OP — selv-helende, ikke et engangs-script', () => {
  const s = sql(indexer, 'DELETE FROM chunk_embeddings');
  expect(s).toContain("d.kind <> 'wiki'");
  expect(s).toContain('DELETE FROM chunk_embeddings');
});

test('ORD-SØGNINGEN OVER KILDER ER URØRT — kontrollen', () => {
  // Den vigtigste prøve i filen. Uden den ville «filtrer kilder væk overalt»
  // bestå lige så grønt, og «hvor kom det her fra?» ville holde op med at kunne
  // besvares. Vi fjerner kilderne fra BETYDNINGS-laget, ikke fra produktet.
  const search = readFileSync(
    new URL('../../../db/src/search.ts', import.meta.url), 'utf8',
  ).replace(/\s+/g, ' ');
  expect(search).toContain('FROM documents_fts');
  expect(search).toContain('FROM chunks_fts');
  expect(search).not.toContain("d.kind = 'wiki'");
  expect(search).not.toContain("pd.kind = 'wiki'");
});
