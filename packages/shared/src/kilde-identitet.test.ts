/**
 * F275.1 — identiteten skal kunne skelne. Hver påstand er parret med sin
 * modsatte, fordi «alt er samme kilde» og «alt er forskelligt» begge består
 * en ensidig prøve.
 */
import { test, describe, it, expect } from 'bun:test';
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

// bun:test — samme løber som resten af pakkens prøver
describe('F275.1 — to skrivemåder af samme URL er ÉN identitet', () => {
  it('DEN MÅLTE SAG: æøå direkte og procent-kodet giver samme identitet', () => {
    // Fundet i produktionen 17/9, inde i featurens egen nøgle. Samme side stod
    // med to identiteter, og afløsningen ville have læst en rettelse af den som
    // en fremmed kilde.
    const a = kildeIdentitet('url', 'https://broberg.ai/indsigter/design-i-højere-luftlag');
    const b = kildeIdentitet('url', 'https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag');
    expect(a).toBe(b);
    expect(a).toBe('url:https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag');
  });

  it('værtsnavnet småskrives — men STIEN beholder sine store bogstaver', () => {
    // Værter er ikke versalfølsomme; stier ER. En normalisering der småskrev
    // begge ville smelte to forskellige sider sammen til én.
    expect(kildeIdentitet('url', 'https://BROBERG.AI/Indsigter')).toBe('url:https://broberg.ai/Indsigter');
    expect(kildeIdentitet('url', 'https://broberg.ai/a')).not.toBe(kildeIdentitet('url', 'https://broberg.ai/A'));
  });

  it('%2F bliver IKKE til en skråstreg — det ville ændre stiens betydning', () => {
    expect(kildeIdentitet('url', 'https://x.dk/a%2Fb')).toBe('url:https://x.dk/a%2Fb');
    expect(kildeIdentitet('url', 'https://x.dk/a%2Fb')).not.toBe(kildeIdentitet('url', 'https://x.dk/a/b'));
  });

  it('en værdi der IKKE er en URL beholdes som den er — ikke droppet', () => {
    // «Kunne ikke normaliseres» må aldrig blive til «har ingen kilde».
    expect(kildeIdentitet('url', 'ikke en url')).toBe('url:ikke en url');
  });

  it('kun `url`-rummet normaliseres — en sti er ikke en URL', () => {
    expect(kildeIdentitet('path', 'kb/Rapport.PDF')).toBe('path:kb/Rapport.PDF');
  });

  it('spørgsmålstegn og fragment overlever', () => {
    expect(kildeIdentitet('url', 'https://x.dk/a?b=1&c=2#d')).toBe('url:https://x.dk/a?b=1&c=2#d');
  });
});
