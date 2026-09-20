/**
 * F285 — DET VAR BROWSEREN, IKKE BRUGEREN.
 *
 * Målt på produktionen 20/9 2026, rapporteret af ejeren: han loggede ind og
 * landede på en 404 inde i appen på /favicon.ico.
 *
 *   GET /favicon.ico   (Sec-Fetch-Dest: image)
 *   → set-cookie: trail-return-to=%2Ffavicon.ico
 *
 * safeReturnPath kunne ikke fange det, og det er hele pointen: den svarer på
 * «er denne sti SIKKER at viderestille til» — og /favicon.ico er fuldstændig
 * sikker. Det manglende spørgsmål er et andet: «har et MENNESKE bedt om
 * den?», og det kan kun besvares ud fra forespørgslens egne headere.
 *
 * MUTATIONS-TJEK, kørt 20. september 2026. Baseline 12/12 grønne:
 *   - `dest === 'document'` → `dest !== 'script'`         6 pass / 6 fail
 *       Jeg gættede 10/2 før jeg kørte den, og skriver det målte tal i stedet.
 *       Seks er mere end den overbærende udgave fortjener at slippe med: den
 *       rammer ikon-kaldet, billed-kaldet, HELE listen af destinationer,
 *       `empty` (SPA'ens egne API-kald), den ukendte fremtidige destination og
 *       Sec-Fetch-Dest-vinder-over-Accept. Det er udgaven man skriver hvis man
 *       kun tænker på den ene asset-type man netop har set.
 *   - fjern Accept-tilbagefaldet (returnér false)         11 pass / 1 fail
 *       rød: «en klient uden Sec-Fetch-Dest men med Accept: text/html huskes».
 *   - fail-open → fail-closed ved INGEN headere           11 pass / 1 fail
 *       rød: «uden begge headere huskes stien». Bevidst valg, se koden.
 */
import { test, expect } from 'bun:test';
import { isDocumentNavigation, returnPathForRequest, safeReturnPath } from './safe-return-path.js';

test('DEN MÅLTE HÆNDELSE: browserens ikon-kald huskes IKKE', () => {
  expect(
    returnPathForRequest({ pathWithSearch: '/favicon.ico', secFetchDest: 'image', accept: 'image/avif,image/webp,*/*' }),
  ).toBe(null);
});

test('men stien er SIKKER — så safeReturnPath alene kunne ikke fange den', () => {
  // Det er grunden til at rettelsen er et NYT spørgsmål og ikke en stramning
  // af det gamle: /favicon.ico er en helt lovlig redirect-destination.
  expect(safeReturnPath('/favicon.ico')).toBe('/favicon.ico');
});

test('en ÆGTE navigation huskes stadig — deep-linket er hele grunden til at cookien findes', () => {
  expect(
    returnPathForRequest({
      pathWithSearch: '/kb/broberg-ai/neurons/en-side',
      secFetchDest: 'document',
      accept: 'text/html,application/xhtml+xml',
    }),
  ).toBe('/kb/broberg-ai/neurons/en-side');
});

test('forespørgselsstrengen følger med — et deep-link kan bære filtre', () => {
  expect(
    returnPathForRequest({ pathWithSearch: '/neurons?tag=adr&q=backup', secFetchDest: 'document' }),
  ).toBe('/neurons?tag=adr&q=backup');
});

test('hver ikke-dokument-destination afvises, ikke kun billeder', () => {
  for (const dest of ['image', 'script', 'style', 'font', 'manifest', 'empty', 'audio', 'video']) {
    expect(isDocumentNavigation({ secFetchDest: dest })).toBe(false);
  }
});

test('`empty` er fetch/XHR og altså ikke en navigation', () => {
  // Den er værd at nævne for sig: det er SPA'ens egne API-kald, og de er
  // netop dem der rammer porten oftest når en session udløber.
  expect(isDocumentNavigation({ secFetchDest: 'empty', accept: 'application/json' })).toBe(false);
});

test('en ukendt fremtidig destination afvises frem for at slippe igennem', () => {
  expect(isDocumentNavigation({ secFetchDest: 'webidentity' })).toBe(false);
});

test('store/små bogstaver og mellemrum i headeren er ligegyldige', () => {
  expect(isDocumentNavigation({ secFetchDest: ' Document ' })).toBe(true);
  expect(isDocumentNavigation({ secFetchDest: 'IMAGE' })).toBe(false);
});

test('UDEN Sec-Fetch-Dest falder vi tilbage på Accept', () => {
  expect(isDocumentNavigation({ accept: 'text/html,application/xhtml+xml,*/*;q=0.8' })).toBe(true);
  expect(isDocumentNavigation({ accept: 'image/avif,image/webp,*/*' })).toBe(false);
  expect(isDocumentNavigation({ accept: 'application/json' })).toBe(false);
});

test('Sec-Fetch-Dest VINDER over Accept når begge findes', () => {
  // En asset-hentning kan godt bære et bredt Accept; destinationen er det
  // direkte svar og skal derfor afgøre.
  expect(isDocumentNavigation({ secFetchDest: 'image', accept: 'text/html,*/*' })).toBe(false);
});

test('UDEN begge headere huskes stien — fail-open, og det er et VALG', () => {
  // Prisen er asymmetrisk: et tabt deep-link er en irritation, mens en
  // afvisning af enhver uklassificerbar navigation tavst ville brække
  // login-genoptagelsen for den klient.
  expect(isDocumentNavigation({})).toBe(true);
  expect(returnPathForRequest({ pathWithSearch: '/neurons' })).toBe('/neurons');
});

test('og sikkerheds-spørgsmålet stilles STADIG — begge skal bestås', () => {
  // En ægte navigation til /login ville loope; den afvises af safeReturnPath.
  expect(returnPathForRequest({ pathWithSearch: '/login', secFetchDest: 'document' })).toBe(null);
  expect(returnPathForRequest({ pathWithSearch: '//evil.example', secFetchDest: 'document' })).toBe(null);
  expect(returnPathForRequest({ pathWithSearch: '/api/v1/me', secFetchDest: 'document' })).toBe(null);
});
