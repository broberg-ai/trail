# F279 — En gemning der LYKKEDES blev meldt som serverfejl

**Kort:** trail-F279 · epic · **høj**
**Fundet:** 17. september 2026, førstehånds, under F275.4's oprydning

---

## Hvad der skete

Jeg gemte `overview.md` (116 kB) gennem kurator-ruten:

```
PUT /api/v1/documents/doc_9abce528-dda/content   500   8s
```

Jeg læste den tilbage. **Skrivningen var gået igennem.** Version 125 → 126,
115.741 tegn — nøjagtig det jeg sendte, al versions-prosa væk.

Motorens log:

```
LibsqlError: SQLITE_UNKNOWN: SQLite error: cannot rollback - no transaction is active
  at mapHranaError (@libsql/client/lib-esm/hrana.js:268)
```

## Hvorfor det er alvorligt

**«500» og «det virkede» var det samme udfald.** En kurator der gemmer en side og
ser en serverfejl, gør det oplagte: gemmer igen. Havde den anden skrivning også
været gennemført, ville siden have fået to versioner for én redigering — og var
teksten i mellemtiden ændret af en anden, ville den anden skrivning have skrevet
hen over noget kalderen aldrig så.

**Det skete ikke, og grunden er værd at skrive ned:** den optimistiske
versionskontrol fangede det. Mit gen-forsøg ramte

```
409 version_conflict: expected 125, got 126
```

— altså en spærre der gjorde præcis sit arbejde. **Den må ikke svækkes af denne
rettelse.** Uden den ville fejlen have været en dobbeltskrivning i stedet for en
forvirrende besked.

## Årsagen, så langt målingen rækker

`cannot rollback - no transaction is active` betyder at transaktionen allerede
var afsluttet da fejlhåndteringen ville rulle tilbage. Altså:

1. commit'en gik igennem — derfor står version 126 på disken,
2. noget kastede DEREFTER,
3. og `rollback` på en lukket transaktion kastede oven i, så **den anden fejl
   maskerede den første**.

Hvad (2) var, ved jeg IKKE. Det står her som et åbent spørgsmål frem for som et
gent — og det er kortets første opgave at måle det, ikke at gaette.

**Den mest sandsynlige kandidat, ikke bekræftet:** kaldet tog **8 sekunder**, og
de to andre gemninger i samme serie tog 4 sekunder og lykkedes. `overview.md` er
116 kB mod 13 kB og 92 kB. En transaktions-timeout på den fjerne libSQL-
forbindelse (hrana) ville give nøjagtig dette billede: transaktionen lukkes
udefra, arbejdet er allerede skrevet, og rollback'en har ingenting at rulle
tilbage. **Det er en hypotese med et tal bag, ikke en diagnose.**

## Afgrænsning

**I kortet:**

- Mål hvad (2) faktisk er. Uden det retter man symptomet.
- Lad kalderen få et SANDT svar: lykkedes skrivningen, så sig det — om nødvendigt
  med et forbehold om at et efterfølgende trin fejlede.
- Rollback på en lukket transaktion må ikke kunne maskere den oprindelige fejl.

**Non-goals:**

- **At svække den optimistiske versionskontrol.** Den er grunden til at dette blev
  en dårlig besked og ikke et datatab.
- **At ændre hvad der skrives.** Indholdet var korrekt hele vejen igennem.
- **At jage størrelsen som sådan.** 116 kB er stort, men «store dokumenter fejler
  nogle gange» er ikke en rettelse.

## Den generelle form

Huset kender fejlen hvor **en manglende værdi degraderer tavst til en selvsikker
succes**. Denne er dens SPEJLBILLEDE: et gennemført arbejde der melder sig som en
fejl. Den er mindre farlig — man mister ikke data, man mister tillid — men den
koster præcis det samme næste gang nogen skal afgøre om en 500 betyder «prøv
igen».

## Stories

| # | | |
|---|---|---|
| F279.1 | Mål hvad der kaster efter commit — og lad kalderen få et sandt svar | høj · 3 SP |
