/**
 * F275.1 — identiteten skal kunne skelne. Hver påstand er parret med sin
 * modsatte, fordi «alt er samme kilde» og «alt er forskelligt» begge består
 * en ensidig prøve.
 */
import { test, expect } from 'bun:test';
import { kildeIdentitet, laesIdentitet, identitetFraMetadata } from './kilde-identitet.js';

test('DEN BÆRENDE: samme URL = samme identitet, forskellig URL = forskellig', () => {
  const a = identitetFraMetadata(JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }));
  const b = identitetFraMetadata(JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }));
  const c = identitetFraMetadata(JSON.stringify({ sourceUrl: 'https://broberg.ai/flagskibe/andet' }));
  expect(a).toBe(b!);
  expect(a).not.toBe(c!);
  expect(a).toBe('url:https://broberg.ai/flagskibe/bid');
});

test('AC#2 NEGATIV KONTROL: samme FILNAVN, forskellig URL → FORSKELLIG identitet', () => {
  // Det er hele grunden til at identiteten ikke må udledes af navnet. To sites
  // kan begge levere index.md. Denne prøve skal gå rød hvis nogen senere
  // bygger en side-identitet på filnavnet.
  const et = identitetFraMetadata(JSON.stringify({ sourceUrl: 'https://a.dk/index' }));
  const to = identitetFraMetadata(JSON.stringify({ sourceUrl: 'https://b.dk/index' }));
  expect(et).not.toBe(to!);
  expect(et).not.toBeNull();
  expect(to).not.toBeNull();
});

test('DEN TREDJE TILSTAND: ingen sourceUrl giver NULL, ikke et gæt', () => {
  // «Vi ved det ikke» må aldrig degradere til «ny kilde» — så ville
  // afløsnings-reglen tie om præcis de sager den findes for.
  expect(identitetFraMetadata(null)).toBeNull();
  expect(identitetFraMetadata('')).toBeNull();
  expect(identitetFraMetadata('{ ikke json')).toBeNull();
  expect(identitetFraMetadata(JSON.stringify({ connector: 'upload' }))).toBeNull();
  expect(identitetFraMetadata(JSON.stringify({ sourceUrl: 42 }))).toBeNull();
});

test('PRÆFIKSET holder to identitets-rum adskilt', () => {
  // Uden det kunne en filsti og en URL kollidere, og kollisionen ville se ud
  // som «samme kilde» — featurens egen fejl, opstået af dens eget felt.
  expect(kildeIdentitet('url', '/a/b')).not.toBe(kildeIdentitet('path', '/a/b')!);
});

test('en TOM værdi er ikke en identitet', () => {
  // Et præfiks foran ingenting ville se gyldigt ud i hver sammenligning,
  // og to kilder uden identitet ville blive «den samme».
  for (const v of ['', '   ', null, undefined]) expect(kildeIdentitet('url', v)).toBeNull();
});

test('laesIdentitet deler op igen — og afviser et ukendt rum', () => {
  expect(laesIdentitet('url:https://a.dk')).toEqual({ rum: 'url', vaerdi: 'https://a.dk' });
  expect(laesIdentitet('path:/x/y.md')).toEqual({ rum: 'path', vaerdi: '/x/y.md' });
  // NEGATIV KONTROL: uden den ville «læs hvad som helst» bestå lige så grønt.
  expect(laesIdentitet('vrøvl:abc')).toBeNull();
  expect(laesIdentitet('ingen-kolon')).toBeNull();
  expect(laesIdentitet('url:')).toBeNull();
  expect(laesIdentitet(null)).toBeNull();
});
