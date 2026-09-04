# F240 — aktivitetsloggen skrev hver hændelse ind i ALLE tenants databaser

**Kort:** trail-F240 · epic · high
**Fundet:** 4. september 2026, som opfølgning på F239 (som gjorde fejlbeskeden læsbar)

## Hvad der faktisk sker

Motoren `trail-engine-001` kører **tre kunder** på samme maskine, hver med sin
egen database:

```
/data/broberg-ai/trail.db
/data/sanne-andersen/trail.db
/data/fd-aalborg/trail.db
```

Baggrundstjenesterne startes i en løkke — **én gang per kunde**. Men de
lytter alle sammen på den **samme** interne beskedkanal, som ikke ved hvilken
kunde en hændelse hører til.

Resultatet: når der sker noget hos ÉN kunde, forsøger aktivitetsloggen at
skrive det ind hos **alle tre**. To af de tre skrivninger går til den forkerte
kundes database.

## Hvorfor det ikke er en læk — og hvorfor det stadig skal rettes

De to forkerte skrivninger **fejler**, hver gang. Databasen har en
fremmednøgle: en aktivitetsrække skal pege på en kunde der findes i *den*
database, og hos de andre to gør den ikke. Så SQLite afviser den.

**Målt 4. september på alle tre produktions-databaser:**

```
broberg-ai      egne tenants=[t-broberg-ai]       activity_log=26.622   fremmede: 0
sanne-andersen  egne tenants=[t-sanne-andersen]   activity_log=334      fremmede: 0
fd-aalborg      egne tenants=[b4ce4f7c-…]         activity_log=63       fremmede: 0
```

**Nul rækker er landet det forkerte sted. Intet er lækket, intet skal ryddes op.**

Men det er den forkerte grund til at være i sikkerhed. En fremmednøgle er en
*bagstopper* — den fanger en fejl der allerede er begået. Her er den blevet
det eneste der holder kundernes data adskilt, og den holder kun så længe to
ting bliver ved med at være sande:

1. hver kundedatabase indeholder præcis sin egen kunde-række, og
2. fremmednøgle-håndhævelse er slået til på appens forbindelse.

Begge er sande i dag. Ingen af dem er noget nogen har lovet. **Flytter vi en
kunde mellem motorer, eller kopierer vi en database, holder (1) op med at
gælde — og så lander den ene kundes aktivitet stille i den andens log.** Det
er præcis den slags fejl der ikke opdages, fordi den ikke fejler.

## Det målte forløb

Et kandidat-forløb hos broberg-ai kl. 13:12:47 dansk tid gav ni skrivninger.
**Tre lykkedes, seks fejlede** — nøjagtigt én ud af tre, altså én per
kundedatabase:

```
[activity-log] write failed for tenant=t-broberg-ai kind=candidate.created:  FOREIGN KEY constraint failed   ×2
[activity-log] write failed for tenant=t-broberg-ai kind=candidate.approved: FOREIGN KEY constraint failed   ×4
```

Forholdet 1:3 er hele beviset. Det er ikke et sammenfald, det er antallet af
kunder på motoren.

> Uden F239 var det her ikke blevet fundet. Fejllinjen sagde før kun hvad vi
> *forsøgte* — hele SQL-sætningen — og aldrig hvorfor det gik galt. Den rigtige
> besked lå i fejlens `cause`, som ingen printede. Det er anden gang på et døgn
> at fejlen sad i måleinstrumentet og ikke i koden.

## Hvad de andre tjenester gør — målt, ikke antaget

Seks tjenester abonnerer på den samme kanal. **Ingen af dem filtrerer på
kunde.** Alle seks kører altså tre gange per hændelse.

| tjeneste | hvad der redder den |
|---|---|
| `reference-extractor` | slår dokumentet op i SIN database først → findes ikke → gør intet |
| `backlink-extractor` | samme |
| `link-checker` | samme |
| `contradiction-lint` | samme |
| `action-recommender` | tjekker **eksplicit** `row.tenantId !== tenantId` og stopper **før** modelkaldet — så der er ikke brugt penge tre gange |
| **`activity-logger`** | **intet. Den skriver først og lader databasen afvise.** |

Fem af seks fejler lukket, fordi deres første handling er et opslag. Den sjette
har ingen første handling — den indsætter. Det er den ene der skal rettes.

**Non-goal:** de fem andre laves ikke om i dette kort. De er korrekte i dag, og
en ombygning af beskedkanalen for at rette noget der virker ville være netop
den slags oprydning husreglerne forbyder. Det der skal stå tilbage er en
*navngiven* måde at være kunde-afgrænset på, så den næste tjeneste ikke
opfinder sin egen.

## Rettelsen (F240.1)

Aktivitetsloggen slår ved første hændelse op hvilke kunder der bor i *dens*
database, husker svaret, og dropper alt andet.

Vagten er bevidst **den samme betingelse som fremmednøglen** — «findes denne
kunde i denne database?» — bare flyttet hen hvor der kan træffes en beslutning,
i stedet for hvor der kastes en fejl. Fremmednøglen bliver stående. Den skal
ikke fjernes fordi vagten kom til; to lag der er enige er billigt, og det er
nøglen der fanger den dag vagten får en fejl.

**Hvorfor ikke bare sammenligne med mappenavnet (`slug`)?** Fordi kunde-id og
mappenavn ikke er det samme: broberg-ai hedder `t-broberg-ai`, men fd-aalborg
hedder `b4ce4f7c-fa2f-44a0-92ca-509145c2f4ce`. En sammenligning på navnet ville
virke for to af tre kunder — og det er værre end at fejle for alle tre, fordi
sådan en fejl ser rigtig ud.

## Prøven

To rigtige databaser i hukommelsen, hver med sin egen kunde-række. Send én
hændelse for kunde A. Tæl rækker i **begge**: A skal have præcis 1, B præcis 0.

**Negativ kontrol, og den er ikke pynt:** uden vagten skal netop den navngivne
prøve gå rød. En grøn prøve uden den beviser kun at prøvedata var venlige — og
i dette tilfælde ville den også være grøn med den nuværende, fejlbehæftede kode,
fordi fremmednøglen afviser skrivningen og `logActivity` sluger fejlen. **Uden
den negative kontrol ville prøven altså bestå på den bug den findes for at
fange.** Det er dagens gennemgående fejlform, en tak ude: ét signal, to
kendsgerninger.

## Afhængigheder

Ingen. Ændringen ligger i `apps/server/src/services/activity-logger.ts`.
Ingen migration, intet skema-skifte, ingen oprydning i data.

## Udrulning

`pnpm ship` til `trail-engine-001`. Verifikation er de to sidste
acceptkriterier: motorens log skal være fri for FOREIGN-KEY-linjer fra
aktivitetsloggen, og proben skal stadig vise nul fremmede rækker.
