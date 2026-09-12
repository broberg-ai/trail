/**
 * F272.2 — FORMEN på /api/v1/documents?awaitingLocalCompile=true er en KONTRAKT.
 *
 * buddy poller den hvert 2. minut for at afgøre om der ligger kilder og venter.
 * Deres aflæser (målt og meldt 12/9 2026) læser en sti i svaret og gør dette:
 *
 *     const count = Array.isArray(pending) ? pending.length
 *                 : typeof pending === 'number' ? pending
 *                 : 0;                                    ← her
 *
 * Findes stien ikke, bliver count 0 — og 0 læses som «drænet»: dedup-nøglen
 * ryddes og der dispatches aldrig igen. «Jeg kunne ikke læse svaret» og «der er
 * ingenting at lave» er altså SAMME VÆRDI hos dem. Loggen ville være tavs og
 * jobbet grønt.
 *
 * De retter deres side (buddy-F330). Det her er VORES halvdel: vi omdøbte
 * «Trails» til «Brains» i samme døgn og skrev Brain-listen om. Havde et af de
 * omdøb rørt dette felt, var deres probe gået blind uden en eneste fejl noget
 * sted — og ingen af os havde opdaget det.
 *
 * Vagten er derfor på NAVNENE, ikke på indholdet.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const kilde = readFileSync(join(import.meta.dir, 'documents.ts'), 'utf8');

describe('probe-kontrakten mod buddy', () => {
  test('svaret hedder STADIG documents + ids', () => {
    // Positiv kontrol først: finder vi overhovedet den linje vi påstår noget om?
    // Uden den ville en omdøbt eller flyttet rute give en grøn prøve der intet måler.
    const linje = kilde.split('\n').find((l) => l.includes('awaitingLocalCompile') === false && l.includes('ids: rows.map'));
    expect(linje, 'retur-linjen findes ikke længere — kontrakten kan ikke måles').toBeDefined();
    expect(linje!).toMatch(/documents:\s*rows/);
    expect(linje!).toMatch(/ids:\s*rows\.map/);
  });

  test('parameteren hedder STADIG awaitingLocalCompile', () => {
    expect(kilde).toContain("c.req.query('awaitingLocalCompile') === 'true'");
  });

  test('kontrakten er skrevet ned dér hvor nogen ville bryde den', () => {
    // En vagt uden en forklaring bliver fjernet af den næste der rydder op.
    expect(kilde).toMatch(/buddy/i);
  });
});
