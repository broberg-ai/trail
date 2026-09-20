# F285 — Login landede på en 404: browserens eget ikon-kald blev husket som «hvor du var på vej hen»

**Ejer-rapporteret 20. september 2026, med skærmbillede.** Efter login stod
Christian på `app.trailmem.com/favicon.ico` med appens egen «404 — Page not
found» inde i den fulde admin-ramme. Hans ord: *«Underlig besked at få når man
logger ind.»*

## Målingen, før noget blev ændret

Ét kald mod produktionen afgjorde sagen:

```
GET /favicon.ico            (Sec-Fetch-Dest: image)
→ set-cookie: trail-return-to=%2Ffavicon.ico

GET /kb/broberg-ai/neurons  (Sec-Fetch-Dest: document)
→ set-cookie: trail-return-to=%2Fkb%2Fbroberg-ai%2Fneurons
```

Begge huskes. Men den første blev hentet af **browseren**, ikke af brugeren.

## Kæden, tre led, alle målt

1. **Der findes ingen `favicon.ico`.** Kun `favicon.svg`, og `index.html`
   erklærer kun den. Browseren beder om `/favicon.ico` alligevel.
2. **SPA-catch-allen tager den.** `app.get('*')` i
   `apps/admin-server/src/index.ts` svarer på alt der ikke er `/api/` eller
   `/auth/`, og huskede hver uautentificeret sti som brugerens destination.
3. **Sidst-skriver-vinder.** Ikon-hentningen rider sideløbende med
   dokument-forespørgslen, så den overskrev det rigtige mål. Efter login
   genoptog SPA'en til `/favicon.ico` — en sti uden rute.

## Hvorfor `safeReturnPath` ikke kunne fange den

Den svarer på **«er denne sti sikker at viderestille til»** — åben-viderestilling,
protokol-relative URL'er, header-splitting, login-loops. Og `/favicon.ico` er
fuldstændig sikker. Den består testen med rette.

Det manglende spørgsmål er et **andet**: *har et menneske bedt om den?* Det kan
ikke besvares ud fra stien, kun ud fra forespørgslens egne headere. Derfor er
rettelsen et nyt spørgsmål frem for en stramning af det gamle — og de to stilles
nu på ét sted, så en fremtidig kalder ikke kan besvare det ene og glemme det
andet.

## Rettelsen

`returnPathForRequest()` i `packages/shared/src/safe-return-path.ts`:

```ts
if (!isDocumentNavigation(input)) return null;
return safeReturnPath(input.pathWithSearch);
```

`isDocumentNavigation` læser `Sec-Fetch-Dest` — `document` for en navigation,
`image`/`script`/`style`/`font`/`empty`/… for en underressource. Hver nuværende
browser sender den. Falder den væk (en gammel klient, curl, en proxy der
stripper den), bruges `Accept: text/html` som tilbagefald.

**Fail-open når INGEN af dem findes**, og det er et valg med en begrundelse:
prisen er asymmetrisk. Et tabt deep-link er en irritation; en afvisning af hver
uklassificerbar navigation ville tavst brække login-genoptagelsen for den klient.

`empty` er værd at nævne for sig: det er SPA'ens egne `fetch`-kald, og de er
netop dem der rammer porten oftest når en session udløber.

## Non-goals

- **Ingen `favicon.ico` tilføjes.** Browseren har allerede `favicon.svg` fra
  `index.html`, og en `.ico` ville kun skjule fejlen for én sti frem for at
  lukke klassen. Catch-allens 302 på `/favicon.ico` er nu harmløs.
- **Catch-allen laves ikke om til at 404'e asset-endelser.** Det er en anden
  beslutning med sin egen risiko (en rigtig side der hedder noget med et punkt
  i), og den er ikke nødvendig for at lukke dette.
- **Klient-siden røres ikke.** `app.tsx` sætter også cookien, men fra
  `window.location.pathname` i en kørende SPA — altså altid en rigtig side.

## Reuse

Discovery-tjek kørt 20/9 2026 på *auth*, *session*, *redirect*.
`@broberg/auth` er den eneste kandidat og er **ikke** relevant: den ejer
login/session-udstedelse, ikke post-login-navigation, og Trail har sin egen
kontrolplan (`apps/admin-server`) med Google OAuth + magic-link. Der findes
ingen `@broberg/*`-pakke for «hvor skulle brugeren hen efter login».

Rettelsen lander derfor i `packages/shared`, hvor `safeReturnPath` allerede bor —
samme fil, samme bekymring, og de to funktioner læses sammen.

## Rollout

Ren serverside-ændring i admin, ingen migration, ingen skema-ændring. En
udrulning er en tovejs-dør. Kræver `ship:admin`, ikke `ship` (som kun tager
motoren).
