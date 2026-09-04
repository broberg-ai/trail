# F222 — maskiner skal kunne skiftes: al tilstand væk fra dem der udruller

**Kort:** trail-F222 · epic · critical
**Revision 2 — 4. september 2026.** Revideret på ejerens ordre og efter hans egen
arkitektur-beslutning (samtalen 4/9, gengivet nedenfor). Revision 1 (2/9) pegede
på Turso som destination; den står nederst som sammenligning og fallback.

> Ejeren, 3. september: *«jeg kan ikke basere en chat på data i trail hvis den
> er nede i 90 → 30 sekunder … maskiner og admin teknik skal afkobles fra
> databaserne komplet.»*

## Hvad 4. september BEVISTE — epicens egen begrundelse, målt i drift

Dagen leverede den måling revision 1 kun kunne forudsige:

- **Alle tre kunder gik ned sammen, to gange på én dag** — én maskine, én
  proces, én disk. En brudt migration tog Sannes kunde-chat med sig; en
  billed-rettelse gjorde hele admin ubrugelig for alle.
- I fejl-øjeblikket: **33 MB ledig hukommelse, belastning 4,36 på én delt
  kerne, 0 swap.** Motoren kørte på den mindste maskine Fly sælger.
- Maskinen er siden sat op til **2 kerner / 4 GB** (ejerens ordre). Det købte
  luft — det flyttede ingen tilstand. Målsætningen er uændret.

## Målbilledet — ejerens model (4/9)

**Princippet: det der udruller ofte, ejer ingen tilstand. Det der ejer
tilstand, udruller næsten aldrig.**

| maskine | antal | udruller | tilstand |
|---|---|---|---|
| **app** (app.trailmem.com — login, admin, API-proxy) | **2** | ofte | **ingen** |
| **engine** (ingest, chat, søgning) | 1 → flere | ofte | **ingen** |
| **DB-maskine** (db.trailmem.com) | 1 | sjældent | **alle trail-databaser + login-databasen**, én database pr. Trail — filmodellen bevares |
| **objektlager** (Tigris, Stockholm) | — | aldrig | alle upload-filer + backups |

**Databasen skal UD af app-laget** (ejerens formulering) og ud af motor-laget:
begge bliver rene programmer der kan genstartes, dubleres og smides væk.

### Hvorfor denne model løser mere end revision 1

1. **API'et kundesites bruger ligger på app-maskinen.** Sannes Eir, widget'en
   og buddy kalder `app.trailmem.com/api/v1/…`, som validerer og sender videre
   til motoren. I dag afbryder BÅDE en app-udrulning og en motor-udrulning
   derfor kundernes API. To app-maskiner + to motorer bag rullende udrulning
   fjerner vinduet — men **kun når tilstanden er væk fra dem**, for en disk
   hører til én bestemt maskine.
2. **Motorer bliver ens, og F170-routerlaget skrumper væk for HA-tilfældet.**
   Hele grunden til at trafik i dag skal rammes på den rigtige motor er at
   kundens database ligger på dens disk. Med databaserne på DB-maskinen kan
   enhver motor betjene enhver kunde; Flys egen fordeling rækker. F170
   genopstår først den dag ydelse (ikke oppetid) kræver sharding.
3. **Revision 1's største risiko OPHØRER.** Frygten var Turso-replikaernes
   sync-churn mod vores FTS5-indeks. I ejerens model er der ingen replika og
   ingen tredjeparts sync-protokol — motoren spørger DB-maskinen direkte.
   Søgeindekset forbliver præcis som det er.
4. **Region-porten OPHØRER også.** Turso kunne ikke bekræftes i Stockholm
   (målt 4/9: deres AWS-liste har kun Irland som EU-region; Fly-platformens
   liste var ikke opdrivelig på skrift). Vores egen DB-maskine er en Fly-maskine
   i `arn` — spørgsmålet findes ikke.

### Teknisk form på DB-maskinen — og hvad der SKAL måles først

En anden maskines SQLite-fil kan ikke bare åbnes over nettet. DB-maskinen
kører derfor **libsql-serveren (sqld)** — den åbne server bag Turso — og
motoren forbinder med den `@libsql/client` vi allerede bruger: forbindelsen
skifter fra en filsti til en URL + token. Én database pr. Trail bevares 1:1.

**Det er stadig en beslutning der først træffes når tallet findes** (F222.2):
en chat kører ~12 søgninger pr. svar, og de går fra lokal disk-læsning til
netværkskald. Samme region betyder få millisekunder pr. kald, men det er en
FORUDSIGELSE — spiken måler den rigtige chat-sti og en rigtig ingest mod en
kopi af en rigtig tenant-database, og skriver p50/p95 her i dokumentet.

### Den ærlige pris, sagt nu

- **DB-maskinen er stadig ÉT punkt.** Forskellen fra i dag: dens eneste job er
  at være oppe, den udruller ikke sammen med software-rettelser, og «i stykker»
  betyder «gendan fra snapshot + backup» — ikke «data er væk». Gendannelsen
  skal ØVES som en del af F222.3, ikke antages: vi har allerede én gang (14/5)
  overlevet på at et snapshot tilfældigvis var 5 timer gammelt.
- **Backup-kæden bliver bærende:** volumen-snapshots + database-kopier til
  objektlageret ad den backup-sti der allerede kører. Read-replikaer og
  udskiftelig DB-maskine er fase 3, ikke dette epic.

## Målingerne planen hviler på (4. september 2026)

```
/data på motoren:   broberg-ai 179 MB · sanne-andersen 2,1 GB · fd-aalborg 7,5 MB
Upload-filer:       KUN Sanne har nogen: 2.427 originaler + 1.396 miniaturer · 2,1 GB
                    broberg-ai: 0 filer (742 billed-rækker peger på død tenant — F225)
                    fd-aalborg: 0 filer (53 rækker uden filer)
Login-databasen:    217 kB (+ 4 MB arbejdslog) på app-maskinens volumen
Chat-mønster:       ~12 søgninger pr. svar; skrivetrafik er få hændelser i timen
```

Det ændrer historiernes vægt: **fil-flytningen er reelt en Sanne-flytning**, og
login-databasen er det mindste flyt i hele planen — men stadig det farligste
pr. byte.

## Rækkefølgen — revideret, princippet uændret: mindst risiko først, intet nøgent skifte

1. **F222.1 — filerne til objektlageret** (uændret først; tal opdateret).
   Sannes 2.427 originaler hash-verificeres én for én. Miniaturerne (F241) er
   AFLEDT data — de kopieres uden ceremoni eller genskabes, de er ikke
   sandhedskilde. broberg-ai/fd-aalborg: intet at flytte; deres døde rækker
   hører til F225, ikke her.
2. **F222.2 — spiken, omskrevet:** DB-maskine i `arn` med sqld + en KOPI af en
   rigtig tenant-database. Mål chat-stiens p50/p95 og en rigtig ingest.
   Turso måles KUN hvis sqld skuffer — som sammenligning, ikke som plan A.
3. **F222.3 — tenant-databaserne til DB-maskinen**, én ad gangen, mindst
   først: fd-aalborg → broberg-ai → sanne-andersen. Uændrede beviser pr.
   tenant (samme søgeresultater, samme svar på F219-regressionscasen) + **en
   ØVET gendannelse fra backup før den første rigtige kunde flyttes.**
4. **F222.4 — login-databasen ud af app-laget**, til samme DB-maskine.
   217 kB, størst blastradius: et rigtigt login bevises mod den nye placering
   FØR den gamle stopper, og `cb@webhouse.dk` verificeres som ejer i alle
   tenants VED AT LOGGE IND, ikke ved at læse en række.
5. **F222.6 (NY) — to app-maskiner og to motorer.** Muligt først nu, hvor
   ingen af dem ejer tilstand. Rullende udrulning, mindst én oppe altid.
6. **F222.5 — beviset:** udrul app OG motor mens rigtig chat-trafik kører, og
   vis 0 fejlede kald — og gør målingen til en vagt der består ved hver
   udrulning, ikke en engangsforestilling.

**Intet nøgent skifte, noget sted:** hvert trin kører begge veje parallelt,
beviser den nye på rigtig trafik, og fjerner først derefter den gamle.

## Reuse

Discovery-tjek (revision 1, genbekræftet 4/9): `@broberg/*` har ingen
objektlager- eller libsql-primitiv; `packages/storage` er vores egen seam med
én implementering, og R2-backup-stien har allerede S3-multipart i produktion.
sqld/libsql er open source; `@libsql/client` er allerede vores driver. Ingen
nye fleet-pakker kræves. Infra-noterne på discovery (`/api/infra`) konsulteres
for Tigris-opsætningen i F222.1.

## Appendiks — revision 1's Turso-spor (nu fallback)

Fire grunde talte for Turso (FTS5 overlever; klienten er vores; én DB pr.
tenant er deres model; objektlager-halvdelen allerede bygget) — de tre første
gælder UÆNDRET for selv-hostet sqld. Tursos risici som målt/vurderet 2–4/9:
sync-churn mod FTS5 (revision 1's risiko A — bortfalder uden replikaer),
region (aws-eu-west-1/Irland er eneste bekræftede EU-region; `arn` ubekræftet),
kold-start-sync på 2 GB-tenants, og en tredjepart på den varme sti. Turso
genovervejes hvis spiken viser at selvhostet drift koster mere end den giver.
