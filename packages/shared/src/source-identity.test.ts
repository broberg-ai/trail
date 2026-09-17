/**
 * F275.1 — identiteten skal kunne skelne. Hver påstand er parret med sin
 * modsatte, fordi «alt er samme source» og «alt er forskelligt» begge består
 * en ensidig prøve.
 */
import { test, describe, it, expect } from 'bun:test';
import { sourceIdentity, readIdentity, identityFromMetadata } from './source-identity.js';

test('DEN BÆRENDE: samme URL = samme identitet, forskellig URL = forskellig', () => {
  const a = identityFromMetadata(JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }));
  const b = identityFromMetadata(JSON.stringify({ connector: 'broberg-ai-site-sync', sourceUrl: 'https://broberg.ai/flagskibe/bid' }));
  const c = identityFromMetadata(JSON.stringify({ sourceUrl: 'https://broberg.ai/flagskibe/andet' }));
  expect(a).toBe(b!);
  expect(a).not.toBe(c!);
  expect(a).toBe('url:https://broberg.ai/flagskibe/bid');
});

test('AC#2 NEGATIV KONTROL: samme FILNAVN, forskellig URL → FORSKELLIG identitet', () => {
  // Det er hele grunden til at identiteten ikke må udledes af navnet. To sites
  // kan begge levere index.md. Denne prøve skal gå rød hvis nogen senere
  // bygger en side-identitet på filnavnet.
  const et = identityFromMetadata(JSON.stringify({ sourceUrl: 'https://a.dk/index' }));
  const to = identityFromMetadata(JSON.stringify({ sourceUrl: 'https://b.dk/index' }));
  expect(et).not.toBe(to!);
  expect(et).not.toBeNull();
  expect(to).not.toBeNull();
});

test('DEN TREDJE TILSTAND: ingen sourceUrl giver NULL, ikke et gæt', () => {
  // «Vi ved det ikke» må aldrig degradere til «ny source» — så ville
  // afløsnings-reglen tie om præcis de sager den findes for.
  expect(identityFromMetadata(null)).toBeNull();
  expect(identityFromMetadata('')).toBeNull();
  expect(identityFromMetadata('{ ikke json')).toBeNull();
  expect(identityFromMetadata(JSON.stringify({ connector: 'upload' }))).toBeNull();
  expect(identityFromMetadata(JSON.stringify({ sourceUrl: 42 }))).toBeNull();
});

test('PRÆFIKSET holder to identitets-rum adskilt', () => {
  // Uden det kunne en filsti og en URL kollidere, og kollisionen ville se ud
  // som «samme source» — featurens egen fejl, opstået af dens eget felt.
  expect(sourceIdentity('url', '/a/b')).not.toBe(sourceIdentity('path', '/a/b')!);
});

test('en TOM værdi er ikke en identitet', () => {
  // Et præfiks foran ingenting ville se gyldigt ud i hver sammenligning,
  // og to kilder uden identitet ville blive «den samme».
  for (const v of ['', '   ', null, undefined]) expect(sourceIdentity('url', v)).toBeNull();
});

test('readIdentity deler op igen — og afviser et ukendt rum', () => {
  expect(readIdentity('url:https://a.dk')).toEqual({ space: 'url', value: 'https://a.dk' });
  expect(readIdentity('path:/x/y.md')).toEqual({ space: 'path', value: '/x/y.md' });
  // NEGATIV KONTROL: uden den ville «læs hvad som helst» bestå lige så grønt.
  expect(readIdentity('vrøvl:abc')).toBeNull();
  expect(readIdentity('ingen-kolon')).toBeNull();
  expect(readIdentity('url:')).toBeNull();
  expect(readIdentity(null)).toBeNull();
});

// bun:test — samme løber som resten af pakkens prøver
describe('F275.1 — to skrivemåder af samme URL er ÉN identitet', () => {
  it('DEN MÅLTE SAG: æøå direkte og procent-kodet giver samme identitet', () => {
    // Fundet i produktionen 17/9, inde i featurens egen nøgle. Samme side stod
    // med to identiteter, og afløsningen ville have læst en rettelse af den som
    // en fremmed source.
    const a = sourceIdentity('url', 'https://broberg.ai/indsigter/design-i-højere-luftlag');
    const b = sourceIdentity('url', 'https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag');
    expect(a).toBe(b);
    expect(a).toBe('url:https://broberg.ai/indsigter/design-i-h%C3%B8jere-luftlag');
  });

  it('værtsnavnet småskrives — men STIEN beholder sine store bogstaver', () => {
    // Værter er ikke versalfølsomme; stier ER. En normalisering der småskrev
    // begge ville smelte to forskellige sider sammen til én.
    expect(sourceIdentity('url', 'https://BROBERG.AI/Indsigter')).toBe('url:https://broberg.ai/Indsigter');
    expect(sourceIdentity('url', 'https://broberg.ai/a')).not.toBe(sourceIdentity('url', 'https://broberg.ai/A'));
  });

  it('%2F bliver IKKE til en skråstreg — det ville ændre stiens betydning', () => {
    expect(sourceIdentity('url', 'https://x.dk/a%2Fb')).toBe('url:https://x.dk/a%2Fb');
    expect(sourceIdentity('url', 'https://x.dk/a%2Fb')).not.toBe(sourceIdentity('url', 'https://x.dk/a/b'));
  });

  it('en værdi der IKKE er en URL beholdes som den er — ikke droppet', () => {
    // «Kunne ikke normaliseres» må aldrig blive til «har ingen source».
    expect(sourceIdentity('url', 'ikke en url')).toBe('url:ikke en url');
  });

  it('kun `url`-rummet normaliseres — en sti er ikke en URL', () => {
    expect(sourceIdentity('path', 'kb/Rapport.PDF')).toBe('path:kb/Rapport.PDF');
  });

  it('spørgsmålstegn og fragment overlever', () => {
    expect(sourceIdentity('url', 'https://x.dk/a?b=1&c=2#d')).toBe('url:https://x.dk/a?b=1&c=2#d');
  });
});
