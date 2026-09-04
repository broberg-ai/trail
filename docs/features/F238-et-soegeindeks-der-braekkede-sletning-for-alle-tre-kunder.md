# F238 — et søgeindeks brækkede billedsletning for alle tre kunder

**Kort:** trail-F238 · epic · **critical** · rettet på prod i samme tur

## Hvordan det blev fundet

Christian havde gennemgået de 212 brudte billeder i en flade jeg byggede til
ham, fravalgt 172 og sagt «SLET DEM». Sletningen fejlede:

```
SQLITE_CORRUPT_VTAB: database disk image is malformed
```

Ikke i sletningen. I databasen — og fejlen var **min, fra samme nat**.

## Årsagen

Migration **0046** (F229.2, otte timer tidligere) oprettede
`document_images_ocr_fts` som en **contentless FTS5-tabel** over
`document_images`. Et sådant indeks er **tomt** når det oprettes over rækker der
allerede findes.

Sletter man så en række, fyrer dens trigger:

```sql
INSERT INTO document_images_ocr_fts(document_images_ocr_fts, rowid, ocr_text)
VALUES ('delete', old.rowid, old.ocr_text);
```

— altså «fjern denne post fra indekset». Posten blev aldrig indsat, og SQLite
svarer med at kalde hele filen misdannet.

**0025 slap for det** fordi den oprettede sit indeks i SAMME migration som
tabellen: der var ingen rækker at være ude af sync med. Den forskel er hele
fejlen, og den er usynlig på en frisk database.

## Omfanget — alle tre tenants, inklusive en kunde

```
sanne-andersen   1.557 billeder   kunne ikke slette
broberg-ai         742 billeder   kunne ikke slette
fd-aalborg          53 billeder   kunne ikke slette   ← en rigtig kunde
```

Otte timer i drift. Ingen opdagede det, fordi ingen havde slettet et billede.

## Hvorfor intet fangede det — fire grønne signaler

```
PRAGMA integrity_check              ok
FTS5 integrity-check, BEGGE indeks  OK
en søgning i indekset               virkede (7 træf)
en frisk database                   virker altid
```

**Fejlen sad i den ene handling ingen af de fire udfører.** Det er husets
gennemgående fejlform i sin skarpeste udgave: instrumenterne var ikke i stykker,
de målte bare noget andet end det der var galt.

Og bemærk hvad der IKKE var galt: grunddatabasen var sund hele vejen igennem.
Ordet «malformed» i SQLites fejlbesked beskriver den virtuelle tabels tilstand,
ikke filen — havde jeg troet på ordet frem for at måle, ville næste skridt have
været en gendannelse fra snapshot af en database der aldrig fejlede noget.

## Diagnosen — trigger for trigger

Reproduceret i en transaktion der blev rullet tilbage, med hver af de seks
triggere slået fra én ad gangen:

```
fejler stadig uden document_images_fts_insert
fejler stadig uden document_images_fts_delete
fejler stadig uden document_images_fts_update
fejler stadig uden document_images_ocr_fts_insert
VIRKER    uden document_images_ocr_fts_delete   ← synderen
fejler stadig uden document_images_ocr_fts_update
```

Ikke «noget med FTS». Én navngiven trigger.

## Rettelsen

Én linje, som 0046 manglede:

```sql
INSERT INTO document_images_ocr_fts(document_images_ocr_fts) VALUES('rebuild');
```

Indekset regenereres fra `document_images`. **Ingen data går tabt** — det er
fuldt udledt af tabellen.

- **0046** bærer den nu, så det ikke kan ske igen på en ny database
- **0048** reparerer databaser der allerede havde kørt 0046
- Kørt manuelt på alle tre tenants med det samme, med før/efter-bevis

## Prøven prøver det den skal bevise: den SLETTER

De fire grønne signaler var alle læsninger. Testen sletter, og den gør det på
en database hvor **rækkerne fandtes før indekset** — den eneste tilstand fejlen
findes i.

**Med negativ kontrol:** uden rebuild SKAL sletningen fejle med «malformed».
Består den, måler testen et indeks der aldrig var i stykker, og beviser
ingenting.

**Og en tredje test pinner teksten i 0046**, ikke kun opførslen: uden den ville
en fremtidig flytning af rebuild til et tredje sted stadig bestå.

Mutations-bevist: fjernes rebuild fra 0046 bliver præcis den test rød.

## Hvad det kostede

Ingenting for kunderne — ingen forsøgte at slette et billede i de otte timer.
Men det er held, ikke design, og det er værd at sige lige ud: **en migration
jeg selv skrev, og hvis egen kommentar handlede om at undgå en enkeltrettet
dør, brækkede en almindelig handling for hver eneste tenant.**
