/**
 * F265.11 — vagten der lover EU skal måle EU.
 *
 * Den gamle vagt tjekkede `usage.provider` og lovede residens i sin fejltekst.
 * En gateway foran Mistral hedder stadig «mistral», så den bestod mens data
 * forlod EU. ai-sdk fandt det som en skærpelse af vores brug (#27112) og målte
 * det afgørende felt på et ÆGTE kald (#27115) før vagten blev sat:
 *
 *   api.mistral.ai/v1            → "eu"
 *   gateway.example.com/mistral  → "unknown"     ← præcis vores hul
 *   api.openai.com/v1            → "us"
 */
import { test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { bekraeftResidens } from './embedder.js';

const OK = { provider: 'mistral', model: 'mistral-embed', region: 'eu' };

test('F265.11 et bekræftet EU-svar slipper igennem', () => {
  expect(() => bekraeftResidens(OK)).not.toThrow();
});

test('F265.11 GATEWAY-HULLET: rigtig provider, ukendt region → AFVIST', () => {
  // DEN BÆRENDE. Det er præcis den her form den gamle vagt lod passere: navnet
  // er rigtigt, værten er ikke Mistrals. «unknown» er ikke et synonym for
  // sikkert — SDK'ens egen .d.ts siger det ordret.
  expect(() => bekraeftResidens({ ...OK, region: 'unknown' })).toThrow(/ikke «eu»/);
});

test('F265.11 us afvises', () => {
  expect(() => bekraeftResidens({ ...OK, region: 'us' })).toThrow(/«us»/);
});

test('F265.11 et MANGLENDE region-felt fejler lukket — med sin EGEN besked', () => {
  // «Vi kunne ikke afgøre hvor kaldet gik hen» er noget andet end «det gik til
  // USA», og kun den første betyder at instrumentet er i stykker. Slås de
  // sammen, leder et menneske det forkerte sted.
  expect(() => bekraeftResidens({ provider: 'mistral', model: 'mistral-embed' }))
    .toThrow(/ingen region/);
});

test('F265.11 provider-tjekket er BEVARET ved siden af — to spørgsmål, ikke ét', () => {
  // Region svarer på «hvor endte data». Provider svarer på «blev min override
  // ignoreret». At erstatte det ene med det andet ville bytte et hul for et
  // andet: en EU-hostet FORKERT model ville slippe igennem.
  expect(() => bekraeftResidens({ provider: 'openai', model: 'x', region: 'eu' }))
    .toThrow(/override blev ignoreret/);
});

test('F265.11 fejlteksterne navngiver det MÅLTE, ikke det håbede', () => {
  // Den gamle tekst lovede EU på et provider-tjek. En fejlbesked der beskriver
  // noget andet end det den målte, sender fejlsøgningen det forkerte sted hen.
  try { bekraeftResidens({ ...OK, region: 'us' }); } catch (e) {
    expect(String(e)).toContain('regionen');
  }
  try { bekraeftResidens({ provider: 'openai', model: 'x', region: 'eu' }); } catch (e) {
    expect(String(e)).not.toContain('uden for EU'); // det var IKKE det der blev målt
  }
});

test('F265.11 override er ALTID med — den umålte OpenAI-vej kan ikke nås herfra', () => {
  // ai-sdk sagde åbent at de kun havde bevist regionen på mistral-ruten, og at
  // et kald UDEN override går til OpenAI. Hos os er den vej ikke nåelig — men
  // «ikke nåelig i dag» er en egenskab ved koden, ikke ved designet, så den
  // holdes fast her. Uden denne prøve kunne en refaktorering fjerne override'en,
  // og persondata ville gå til USA (hvor den nye vagt så ville fange det, men
  // først EFTER kaldet var sendt).
  const kode = readFileSync(new URL('./embedder.ts', import.meta.url), 'utf8');
  expect(kode).toContain("override: { provider: EMBEDDING_PROVIDER, model: EMBEDDING_MODEL, transport: 'http' }");
  expect(kode).toContain('bekraeftResidens(usage);');
});
