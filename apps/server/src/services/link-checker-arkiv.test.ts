/**
 * F257.2 — et fund hvis KILDE-dokument er arkiveret skal lukkes.
 *
 * MÅLT 6/9 i broberg.ai: 42 af 178 åbne fund (24 %) kom fra arkiverede
 * dokumenter. Ikke ét fra et aktivt. Fuld-scanningen springer arkiverede over
 * — korrekt — men lukkede aldrig deres fund, så de blev permanent inventar på
 * en side ingen kunne gøre færdig.
 *
 * Prøven læser den ÆGTE SQL frem for min gengivelse af den.
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';

const kilde = readFileSync(new URL('./link-checker.ts', import.meta.url), 'utf8');
const sql = kilde.slice(kilde.indexOf('UPDATE broken_links')).slice(0, 500).replace(/\s+/g, ' ');

test('OPRYDNINGEN RAMMER KUN ARKIVEREDE KILDE-DOKUMENTER', () => {
  expect(sql).toContain('archived = 1');
  expect(sql).toContain("status = 'open'");
});

test('NEGATIV KONTROL: den kan ikke ramme et AKTIVT dokuments fund', () => {
  // Den vigtigste prøve i filen. Uden `archived = 1` ville sætningen lukke HELE
  // tavlen og se ud som en fantastisk rettelse — 178 → 0 på et øjeblik, uden at
  // ét eneste link var blevet bedre.
  expect(sql).not.toContain('archived = 0');
  expect(sql).toMatch(/from_document_id IN \(\s*SELECT id FROM documents/);
});

test('fundet RESOLVES, det SLETTES ikke — rækken er dokumentation', () => {
  // Et slettet fund skjuler at linket nogensinde var brudt. Vi vil kunne se at
  // det var det, og at grunden til at det forsvandt var en arkivering.
  expect(sql).toContain("SET status = 'resolved'");
  expect(sql).not.toContain('DELETE');
});

test('oprydningen er scopet til tenant OG videnbase', () => {
  // Uden begge ville en fuld-scanning i én kundes base kunne lukke fund i en
  // andens. Den slags fejl er tavs og krydser en kundegrænse.
  expect(sql).toContain('tenant_id =');
  expect(sql).toContain('knowledge_base_id =');
});

test('arkiv-lukninger tælles FOR SIG i rapporten', () => {
  // «linket blev repareret» og «siden findes ikke længere» er to forskellige
  // grunde til at et fund forsvinder. Slås de sammen, ser en arkivering ud som
  // en reparation.
  expect(kilde).toContain('arkivLukket');
});
