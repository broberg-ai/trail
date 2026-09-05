# F222 — maskiner skal kunne skiftes: al tilstand væk fra dem der udruller

**Kort:** trail-F222 · epic · critical
**Revision 3 — 4. september 2026 (aften).** Tilføjer failover-modellen efter
ejerens indvending mod «nede i minutter + et script et menneske skal køre».
Revision 2 (samme dag) satte ejerens DB-maskine-model i stedet for revision 1's
Turso-spor (2/9), som nu står nederst som fallback.

> Ejeren, 3. september: *«jeg kan ikke basere en chat på data i trail hvis den
> er nede i 90 → 30 sekunder … maskiner og admin teknik skal afkobles fra
> databaserne komplet.»*

## Hvad 4. september BEVISTE — epicens egen begrundelse, målt i drift

- **Alle tre kunder gik ned sammen, to gange på én dag** — én maskine, én
  proces, én disk. En brudt migration tog Sannes kunde-chat med sig; en
  billed-rettelse gjorde hele admin ubrugelig for alle.
- I fejl-øjeblikket: **33 MB ledig hukommelse, belastning 4,36 på én delt
  kerne, 0 swap.** Motoren kørte på den mindste maskine Fly sælger.
- Maskinen er siden sat op til **2 kerner / 4 GB** (ejerens ordre). Det købte
  luft — det flyttede ingen tilstand. Målsætningen er uændret.

## Målbilledet — ejerens model (4/9), inkl. redundans

**Princippet: det der udruller ofte, ejer ingen tilstand. Det der ejer
tilstand, udruller næsten aldrig.**

| maskine | antal | udruller | tilstand |
|---|---|---|---|
| **app** (app.trailmem.com — login, admin, API-proxy) | **2** | ofte | **ingen** |
| **engine** (ingest, chat, søgning) | 1 → flere | ofte | **ingen** |
| **DB-primær** (db.trailmem.com) | 1 | sjældent | **alle trail-databaser + login-databasen**, én database pr. Trail — filmodellen bevares |
| **DB-replika** (fase 3, F222.7) | 1 | sjældent | løbende kopi af primæren — gerne hos en ANDEN udbyder, så den også dækker en Fly-hændelse i Stockholm |
| **objektlager** (Tigris, Stockholm) | — | aldrig | alle upload-filer + backups |

**Databasen skal UD af app-laget** (ejerens formulering) og ud af motor-laget:
begge bliver rene programmer der kan genstartes, dubleres og smides væk.

### Failover-modellen — ejerens krav: ingen minutter nede, intet menneske klokken tre

Ejerens indvending, 4/9: *«Jeg er stadig ikke vild med en plan hvor vi kan være
nede i minutter og at det er et script der skal køres for at lave changeover —
hvem kører det script?»* Modellen svarer i tre lag:

1. **Læsning falder AUTOMATISK over — og læsning er det kritiske.** Motoren
   kender begge DB-maskiner og skifter selv til replikaen for opslag når
   primæren ikke svarer. Kundernes chat og søgning mærker INGENTING: ingen
   minutter, intet script. Trail er læse-tung og skrive-let, så det der venter
   under en primær-nedtur er en håndfuld skrivninger — synligt, aldrig tavst.
2. **Forfremmelsen (replika → primær for SKRIVNINGER) køres af en vagt, ikke
   et menneske.** Buddy/cron overvåger primæren og forfremmer automatisk —
   men KUN når Fly selv bekræfter at maskinen er DØD, ikke blot tavs. Den
   skelnen er bærende: forfremmes der mens primæren kun er *unåelig*, kan to
   maskiner tro de er chef og skrive hver sin sandhed (split-brain). Ejeren
   får BESKED, ikke et spørgsmål.
3. **Vil vi hellere købe end bygge, er dét Turso.** Automatisk failover er
   præcis varen de sælger. Spiken (F222.2) holder døren åben: viser
   vagt-bygningen sig tungere end ventet, er svaret at betale.

Slutbilledet: **kunderne oplever nul nedetid ved en død DB-maskine; nye
skrivninger holder en kort, synlig pause; intet menneske skal gøre noget om
natten.** Tabsvinduet (en skrivning der kun nåede primæren) måles og
rapporteres — «lille» er en måling, ikke et tillidsord (F222.7's AC).

### Hvorfor denne model løser mere end revision 1

1. **API'et kundesites bruger ligger på app-maskinen.** Sannes Eir, widget'en
   og buddy kalder `app.trailmem.com/api/v1/…` → proxy → motor. I dag afbryder
   BÅDE en app-udrulning og en motor-udrulning derfor kundernes API. To
   app-maskiner + to motorer bag rullende udrulning fjerner vinduet — men kun
   når tilstanden er væk fra dem, for en disk hører til én bestemt maskine.
2. **Motorer bliver ens, og F170-routerlaget skrumper væk for HA-tilfældet.**
   Trafik skal i dag rammes på den rigtige motor fordi kundens database ligger
   på dens disk. Med databaserne på DB-maskinen kan enhver motor betjene
   enhver kunde; Flys egen fordeling rækker. F170 genopstår først den dag
   ydelse (ikke oppetid) kræver sharding.
3. **Revision 1's største risiko OPHØRER.** Frygten var Turso-replikaernes
   sync-churn mod vores FTS5-indeks. Motoren spørger DB-maskinen direkte;
   søgeindekset forbliver præcis som det er. (Vores EGEN replika synker også —
   men med libsqls egen replikering, uden tredjeparts minimums-enheder, og
   målt i F222.7 før den loves noget.)
4. **Region-porten OPHØRER.** Turso kunne ikke bekræftes i Stockholm (målt
   4/9: kun Irland på deres AWS-liste). Vores DB-maskiner er egne maskiner —
   primæren i `arn`; replikaen bevidst gerne hos en anden udbyder.

### Teknisk form — og hvad der SKAL måles først

DB-maskinen kører **libsql-serveren (sqld)** — den åbne server bag Turso — og
motoren forbinder med den `@libsql/client` vi allerede bruger: filsti bliver
til URL + token. Én database pr. Trail bevares 1:1. Replikaen (fase 3) bruger
libsqls indbyggede replikering.

**Intet loves før tallet findes** (F222.2): en chat kører ~12 søgninger pr.
svar, og de går fra lokal disk til netværk. Samme region betyder få
millisekunder pr. kald — det er en FORUDSIGELSE. Spiken måler den rigtige
chat-sti og en rigtig ingest mod en kopi af en rigtig tenant-database, plus én
ØVET gendannelse fra snapshot, og skriver tallene her i dokumentet.

### Redundans-stigen

| lag | dækker | tab ved brug | automatik |
|---|---|---|---|
| Snapshots (automatisk) | fejl på maskinen | op til timer | fuld |
| Backup i objektlageret | fejl hos Fly / volumen væk | op til en dag | fuld |
| **Replika (F222.7)** | primær DB-maskine dør | **læsning: nul · skrivning: kort synlig pause** | læse-failover fuld; skrive-forfremmelse via vagt, kun ved Fly-bekræftet død maskine |

**Supabase som fallback er FRAVALGT** (4/9, begrundelse i F222.7-planen): det
er en anden database-motor, søgningen er SQLites FTS5, og en kopi motoren ikke
kan boote på er en backup, ikke en fallback — og backups findes allerede.

## F222.2 — spikens facit (5. september 2026): sqld BESTÅR, Turso-appendikset er lukket

**Opstilling:** ny Fly-app `trail-db-001` (org broberg-ai, region arn, shared-cpu-1x/1GB,
10 GB volumen, INGEN offentlig IP — kun Flys private IPv6-net) med sqld
(`ghcr.io/tursodatabase/libsql-server`). Indlæst en `VACUUM INTO`-kopi af den RIGTIGE
sanne-andersen trail.db (338 dokumenter / 569 chunks / 35 MB, sha256 `c6677033…e78ffc3e`
identisk gennem alle hop). Alle målinger kørt FRA motormaskinen med den ÆGTE kode
(`searchChunks`/`searchDocuments`/`loadNeuronConfidence`/`createCandidateQueueAPI.write`)
og 12 RIGTIGE brugerforespørgsler fra Sannes chathistorik — script:
`apps/server/scripts/verify-f222-2-sqld-spike.ts`, negativ kontrol først.

```
FULD chat-retrieval (hele retrieveContext-sekvensen, n=60 pr. konfiguration):
  lokal fil    p50 15,7 ms · p95 25,9 ms · max 26,9 ms
  sqld remote  p50 40,0 ms · p95 48,0 ms · max 56,2 ms   ← +24 ms pr. svar

INGEST-skrivesti (rigtige wiki-writes m. FTS-indeksopdatering, 8 writes):
  lokal fil    p50 15 ms · max 26 ms
  sqld remote  p50 52 ms · max 84 ms — og de nye sider findes STRAKS i FTS

PARITET: 12/12 forespørgsler giver IDENTISKE resultater lokal vs sqld.
  Rækketal ens (338/569/1). FTS5-indekset overlever uændret.

GENDANNELSE (ØVET, ikke antaget): maskine destrueret → ny volumen fra
  snapshot → boot → søgbar med identiske svar: **68 sekunder** i alt.
  Spike-skrivningerne var korrekt VÆK efter gendannelsen (ægte øjebliksbillede).
```

**Beslutningen tallene bærer:** +24 ms på en chat der venter sekunder på LLM'en er
usynligt for kunden — sqld-modellen HOLDER, og Turso-appendikset nedenfor forbliver
lukket (genåbnes kun hvis driften skuffer). Fundet undervejs, vigtigt for F222.3:
sqld på Fly SKAL lytte på IPv6 (`SQLD_HTTP_LISTEN_ADDR=[::]:8080` — 0.0.0.0 er
uopnåelig over Flys private net), datamappen er `/var/lib/sqld/iku.db/dbs/default/data`,
og en eksisterende SQLite-fil lagt dér FØR første boot serveres direkte — det er
migrationsvejen pr. tenant. Spiken kørte UDEN auth (kun privat net); F222.3 skal
sætte sqld's egen auth på før rigtige tenants flyttes. Oprydning til F222.3: den
løsrevne volumen `vol_rnzl2qgk` (erstattet af gendannelses-volumen) + en stray
seed-fil på `/var/lib/sqld/dbs/default/data` (forkert sti, harmløs).

## Målingerne planen hviler på (4. september 2026)

```
/data på motoren:   broberg-ai 179 MB · sanne-andersen 2,1 GB · fd-aalborg 7,5 MB
Upload-filer:       KUN Sanne har nogen: 2.427 originaler + 1.396 miniaturer · 2,1 GB
                    broberg-ai: 0 filer (742 billed-rækker peger på død tenant — F225)
                    fd-aalborg: 0 filer (53 rækker uden filer)
Login-databasen:    217 kB (+ 4 MB arbejdslog) på app-maskinens volumen
Chat-mønster:       ~12 søgninger pr. svar; skrivetrafik er få hændelser i timen
```

Fil-flytningen er reelt en Sanne-flytning, og login-databasen er det mindste
flyt i planen — men stadig det farligste pr. byte.

## Rækkefølgen — mindst risiko først, intet nøgent skifte

1. **F222.1 — filerne til objektlageret.** Sannes 2.427 originaler
   hash-verificeres én for én. Miniaturerne (F241) er AFLEDT data — kopieres
   uden ceremoni eller genskabes. broberg-ai/fd-aalborg: intet at flytte
   (deres døde rækker er F225).
2. **F222.2 — spiken:** DB-maskine i `arn` med sqld + kopi af rigtig
   tenant-database. Chat-stiens p50/p95, en rigtig ingest, én øvet
   gendannelse. Turso måles kun hvis sqld skuffer.
3. **F222.3 — tenant-databaserne**, én ad gangen: fd-aalborg → broberg-ai →
   sanne-andersen. Pr. tenant: samme søgeresultater, samme svar på
   F219-regressionscasen, og øvet gendannelse FØR første rigtige kunde.
4. **F222.4 — login-databasen ud af app-laget.** 217 kB, størst blastradius:
   rigtigt login bevises mod ny placering før den gamle stopper;
   cb@webhouse.dk ejer i alle tenants, bevist VED LOGIN.
5. **F222.6 — to app-maskiner og to motorer.** Muligt først nu. Rullende
   udrulning, mindst én af hver altid oppe — bevist destruktivt (sluk én
   hårdt, API'et svarer stadig).
6. **F222.5 — beviset som stående vagt:** udrul app OG motor under rigtig
   chat-trafik, 0 fejlede kald, målt ved hver udrulning fremover.
7. **F222.7 — replikaen (fase 3):** læse-failover i motoren, vagt-styret
   forfremmelse ved Fly-bekræftet død maskine, målt tabsvindue, gerne anden
   udbyder. Ren tilføjelse — intet fra trin 1–6 laves om.

## Reuse

Discovery-tjek (rev. 1, genbekræftet 4/9): ingen `@broberg/*`-primitiv for
objektlager eller libsql; `packages/storage` er egen seam med én
implementering; R2-backup-stien har S3-multipart i produktion; `@libsql/client`
er allerede driveren. Infra-noterne på discovery (`/api/infra`) konsulteres for
Tigris-opsætningen i F222.1.

## Appendiks — revision 1's Turso-spor (nu fallback / køb-i-stedet)

Fire grunde talte for Turso (FTS5 overlever; klienten er vores; én DB pr.
tenant er deres model; objektlager-halvdelen bygget) — de tre første gælder
uændret for selvhostet sqld. Tursos risici som målt/vurderet 2–4/9: sync-churn
mod FTS5 (bortfalder uden deres replikaer), region (kun Irland bekræftet EU;
`arn` ubekræftet), kold-start-sync, tredjepart på den varme sti. **Turso er
samtidig køb-muligheden for automatisk failover** — genovervejes hvis F222.2
viser at selvhostet drift, eller F222.7 at vagt-bygningen, koster mere end den
giver.
