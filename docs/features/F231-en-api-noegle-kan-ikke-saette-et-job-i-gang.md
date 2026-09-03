# F231 — en API-nøgle kan ikke sætte et job i gang, og fejlen siger det ikke

**Kort:** trail-F231 · epic + F231.1 · medium

## Fundet mens noget andet skulle bevises

F229.2 skulle bevises på prod: kør OCR på ét ægte billede i Sannes Trail og se
teksten dukke op. `POST /api/v1/jobs` svarede **500 Internal Server Error**.

I loggen:

```
LibsqlError: SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed
  at submit (apps/server/src/services/jobs/runner.ts:113)
  at POST /api/v1/jobs
```

`jobs.user_id` har en fremmednøgle til `users.id`. En **Bearer-API-nøgle** har
ingen række i motorens `users`-tabel, så indsættelsen kan ikke lykkes. Kun en
indlogget admin-session kan starte et job.

## Hvorfor det er værd at rette, og ikke bare at vide

**Fejlen fortæller intet.** «Internal Server Error» dækker over noget der er
fuldt forudsigeligt: *denne nøgle må ikke starte jobs*. En kalder — et script,
en CI-kørsel, en peer-session, eller en cc-session der skal verificere sit eget
arbejde — kan ikke skelne «jeg er ikke velkommen» fra «serveren er i stykker».

Det er husets gennemgående fejlform i sin fjerde variant på ét døgn: **et signal
der dækker to tilstande.** De tre andre var de 212 brudte billed-links, klatterne
der lignede indhold, og OCR der opfandt en formel.

**Og det blokerer en verifikationsvej.** Reglen i dette repo er at intet må
kaldes færdigt uden runtime-bevis. Jobbet er den eneste måde at køre vision/OCR
på et enkelt eksisterende billede — så uden den vej kan netop den halvdel af
F229.2 ikke bevises på prod, kun lokalt.

## Scope

**I scope (F231.1):** en API-nøgle skal enten kunne starte et job, eller få et
**klart 403 med en grund**. Hvilken af de to er en beslutning, ikke en detalje —
se de åbne spørgsmål.

**Non-goals:**
- Ingen ændring af hvad jobs GØR.
- Vi laver ikke bruger-rækker for API-nøgler som en bivirkning af et jobkald.
  En falsk bruger for at få en fremmednøgle til at gå op er præcis den slags
  løsning der ser rigtig ud og flytter problemet.

## Åbne spørgsmål — bevidst ikke besvaret her

1. **Skal en API-nøgle overhovedet kunne starte jobs?** Et job koster penge
   (vision + OCR pr. billede). Argumentet FOR: scripts og CI skal kunne
   verificere. Argumentet IMOD: en lækket nøgle kan så brænde kredit.
2. Hvis ja: hvem står som ejer af jobbet? Nøglens ejer er det oplagte svar —
   nøglen er udstedt af en bruger — men det kræver at nøglen bærer det id.

Indtil de er afgjort er **det klare 403 den rigtige delmængde**: det fjerner
den forvirrende 500 uden at træffe beslutningen om adgang.
