# F253 — Hjerne-versioner: mærk hjernen, og rul den tilbage

> **Status:** planlagt. F253.1 (tætningen) er BYGGET og deployet 6. september 2026.
> **Ejerens ord, 6. september 2026:** «Kan vi lave en komplet Neurons versioning (brain version - snapshot) mellem hver compilation så vi altid kan rulle tilbage på den måde, som om noget nyt slettes fra hukommelsen?» — og derefter: «Det fylder jo ikke ret meget i databasen.»
> Han har ret, og grunden er bedre end han vidste: **kopierne findes allerede.**

## Motivation

Den 4.–5. september formerede 39 kilde-filer sig til 90 Neuron-sider i broberg-ai, fordi `approveCreate` altid indsatte en ny række (F252.1). Oprydningen var mulig — men kun fordi dubletterne var *synlige*. Havde stormen i stedet **ændret** 90 eksisterende sider, havde der ikke været noget at pege på: ingen liste over hvad der blev anderledes, og ingen måde at sige «giv mig hjernen som den var fredag aften».

Det er hullet. Trail kan i dag fortryde **én side**, hvis nogen ved hvilken. Den kan ikke fortryde **en omgang**.

## Den målte kendsgerning der afgør designet

Målt i broberg-ai's produktions-base 6. september 2026:

| | |
|---|---|
| Hændelser i `wiki_events` | **8.393** |
| Hændelser **uden** `content_snapshot` | **0** |
| Kopiernes samlede størrelse | **43 MB** |
| Hele basen | 249 MB |
| Aktive Neuroner | 6.741 |
| Neuroner uden nogen historik | **0** |

**Trail har gemt en fuld kopi af hver Neuron ved hver eneste skrivning, siden starten.** Kolonnens egen kommentar siger hvorfor: *«Full content snapshot at this event (not a diff). Enables replay and time-travel without reconstructing from the current document.»*

Tidsrejsen er altså allerede betalt. **Det der mangler er ikke lagring — det er et håndtag.**

## Beslutningen: en version er et BOGMÆRKE, ikke en kopi

Den oplagte læsning af «snapshot mellem hver kompilering» er: kopiér hele hjernen ved hvert mærke. Det ville koste ~18 MB pr. mærke (aktivt Neuron-indhold) og lave en base på flere gigabyte inden for en uge.

Det er unødvendigt, fordi indholdet **allerede** ligger i hændelses-loggen. En hjerne-version behøver derfor kun at være:

```
brain_versions
  id · tenant_id · knowledge_base_id
  label            ← "Før CMS-synkronisering 5/9"
  taken_at         ← tidspunktet mærket peger på
  high_water_event ← nyeste wiki_event på det tidspunkt (tie-break)
  reason           ← 'auto:ingest' | 'auto:lint' | 'auto:bulk-approve' | 'manual'
  coverage_intact  ← var loggen komplet da mærket blev taget?
```

**Pris pr. version: nogle hundrede bytes.** Ikke 18 MB.

Gendannelse er så et opslag, ikke en udpakning:

- for hver Neuron: find dens **seneste hændelse ≤ mærket** → sæt `content` tilbage til dens `content_snapshot`
- Neuron hvis **første** hændelse er *efter* mærket → **arkivér** (den fandtes ikke dengang)
- Neuron der blev **arkiveret efter** mærket → **gendan** (den fandtes dengang)
- byg søgeindekset (`document_chunks`) om for det der ændrede sig

## Ikke-mål (bevidst udenfor)

- **De rå kilde-filer.** 334 af dem har ingen hændelses-log. De er råvarer man kan uploade igen — ikke hukommelse. At lade som om de var dækket ville være det farlige.
- **Køen, tillids-signaler, aktivitetslog.** En tilbagerulning af *viden* skal ikke slette *sporet* af hvad der skete. Historikken om rulningen er selv værdifuld.
- **Uploadede filer på disken.** Uændret; kun `documents` og `wiki_events` er i spil.
- **Andre tenants.** Et mærke er pr. videnbase.

## Arkitektur

```
packages/core/src/history/
  coverage.ts     ← F253.1  BYGGET: er loggen komplet nok til at rulle tilbage?
  versions.ts     ← F253.2  tag et mærke · list mærker
  restore.ts      ← F253.3  beregn forskellen · udfør gendannelsen
```

HTTP (motoren, `apps/server/src/routes/brain-versions.ts`):

```
POST   /knowledge-bases/:kbId/brain-versions          tag et mærke
GET    /knowledge-bases/:kbId/brain-versions          list dem
GET    /brain-versions/:id/diff                       hvad ville ændre sig?
POST   /brain-versions/:id/restore                    gør det
```

## Rækkefølgen, og hvorfor den ikke er til forhandling

**F253.1 kommer først, og den er allerede bygget.** Et håndtag er kun så godt som loggen under det, og loggen havde en revne: 2 af 6.741 Neuroner havde et indhold der ikke matchede deres egen nyeste kopi, fordi et script 24. april skrev direkte i basen udenom appen. En tilbagerulning ville have meldt succes og efterladt en hjerne der var *næsten* rigtig — den værste slags fejl, fordi den fejler i den grønne retning.

## Stories

| # | Hvad | Status |
|---|---|---|
| **F253.1** | Dæknings-invariant + reparation — er loggen komplet? | **bygget 6/9** |
| **F253.2** | Tag et mærke, automatisk før hver omgang + manuelt | planlagt |
| **F253.3** | Vis forskellen, og udfør gendannelsen | planlagt |
| **F253.4** | Fladen: se mærker, se forskellen, rul tilbage | planlagt |

### F253.2 — mærket

**Ét mærke pr. OMGANG, ikke pr. side.** «Mellem hver kompilering» taget bogstaveligt giver 100 mærker på én eftermiddag ved en site-synkronisering, og ingen af dem bærer et navn man kan genkende. Prisen er ikke problemet (nogle hundrede bytes); **navigationen er**. En liste på 100 unavngivne mærker er ikke en fortrydelses-knap, det er en anden slags rod.

Automatisk mærke før: en ingest-omgang · en lint-kørsel · en bunke-godkendelse. Plus en «gem hjernen nu»-knap.

**Mærket kører dæknings-tjekket først og reparerer hvad det finder.** Så er hvert mærke komplet ved konstruktion, og `coverage_intact` fortæller sandheden om det mærke i stedet for at lade en senere gendannelse opdage det.

### F253.3 — gendannelsen

**Gendannelsen er SELV en hændelse.** Hver side der sættes tilbage får en `edited`-hændelse med sin nye (gamle) tekst som kopi. Så kan man fortryde en fortrydelse, og loggen bliver ikke usammenhængende af at blive brugt. En destruktiv overskrivning uden spor ville ødelægge netop det den skal beskytte.

**Forskellen vises FØR den udføres.** «Dette vil sætte 47 Neuroner tilbage, arkivere 12 og gendanne 3» — og en tilbagerulning man ikke kan se konsekvensen af, tør ingen bruge, hvilket gør funktionen værdiløs præcis den dag den skal bruges.

## Reuse

Discovery-tjek kørt 6/9 mod `discovery.broberg.ai/api/search`:

| Behov | Findes der en `@broberg/*`? | Beslutning |
|---|---|---|
| Versionering af domæne-data | Nej | Byg her — det er Trails eget skema |
| Øjebliksbillede/gendannelse | Nej (`@broberg/*` dækker mail, push, auth, ai-sdk, config, cron, apikey, lens, secret-scan, pwa, webpush) | Byg her |
| Diff-visning i UI | Nej | Byg med repoets egne primitiver |

Intet at genbruge: det her er domæne-logik oven på Trails eget skema, ikke en tværgående evne. Bliver mekanismen generel (fx «versionér enhver tabel med en hændelses-log»), er DET kandidaten til `components` — ikke før.

## Rollout

1. F253.1 deployet → kør `verify-event-log-coverage.ts --repair` mod produktion, læs tilbage.
2. F253.2 → mærker begynder at lande. Ingen adfærdsændring for nogen; kun rækker.
3. F253.3 → gendannelse bag en bekræftelse, med forskellen vist først.
4. F253.4 → fladen.

Ingen nøgen udskiftning: den eksisterende per-side-historik bliver stående uændret hele vejen igennem.
