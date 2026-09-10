# F266 — Kuratorkøen er fuld af ting du ikke skal se på

**Status:** i gang · **Prioritet:** høj

> Christian, 10. september 2026: *«Min Curator Queue bliver hurtigt fyldt i trail fra agenter der spammer os. Hvad gør vi?»* og *«hvis jeg skal have en APN for hver neuron for hver kunde så eksploderer min iphone vist :)»*

## Målingen der ændrede spørgsmålet

Første svar var forkert og skal stå her, fordi det er den slags tal der ellers bliver handlet på: jeg meldte **13.379 ventende** i broberg-ai. Det var ALLE kandidater nogensinde — jeg læste et `count`-felt uden at tjekke hvad det talte, og endpointet tæller som standard hver status.

De rigtige tal:

| lejer | venter | godkendt | afvist |
|---|---:|---:|---:|
| broberg-ai | **595** | 9.477 | 3.308 |
| sanne-andersen | **334** | 496 | 31 |
| fd-aalborg | **33** | 189 | 4 |

**Og «agenterne der spammer» er ikke problemet.** Alt buddy sender ind auto-godkendes allerede i samme sekund det skrives — af 5.777 venter kun 47, nøjagtig dem der kom ind under tærsklen på 0,8. Den mekanisme ejeren bad om findes og virker.

Hvad der FAKTISK venter (856 af 962):

| kilde | venter | hvad det er |
|---|---:|---|
| trail-ambient-capture | 526 | menubar-agenten på Macen |
| lint hos Sanne | 330 | modsigelses- og støvtjekkeren |
| lint hos broberg-ai | 19 | |

## De to fund der stoppede den oplagte handling

Begge blev fundet ved at KIGGE på indholdet før en masse-handling, og begge ville have kostet noget uigenkaldeligt.

### 1. Ambient ville udgive private noter på hjemmesiden

De 526 lander i `broberg-ai` — den videnbase hjemmesidens chat svarer ud fra. En auto-godkendt kandidat lander på `/neurons/auto/`, og publikums-filteret (F160) skjuler kun `HEURISTIC_PATH` og ting mærket `internal`. Ambient-kandidater bærer **ingen tags**.

Læst i køen:

```
«Overvejer at lease hus i Blokhus på lang sigt»
«… CRM-system til Broberg.ai med arbejdstitlen "Orbit"»
«Sign in to Abion Core …»
```

Private boligovervejelser, uannoncerede produktplaner og en login-skærm. Der ligger **0** dokumenter under `/neurons/auto/` i dag, så intet er sluppet ud — men tærsklen ville have gjort ~500 af dem synlige for besøgende.

### 2. Sannes 330 lint-kandidater er ikke alle støj

| type | antal |
|---|---:|
| Stale Neuron | 237 |
| **Contradiction** | **73** |
| Orphan Neuron | 17 |
| Unused Source | 3 |

De 73 er linteren der siger «to Neuroner i denne hjerne er uenige». I en zoneterapi-videnbase kan det betyde at Sannes chat giver modstridende svar om en behandling. Drænet (`/maintenance/drain-lint-candidates`) filtrerer på **connector**, ikke på type — så «ryd Sannes lint» tager alle 330 med de 73 indenunder.

Drænets EGEN sikkerhedsregel siger ordret at den aldrig må auto-afvise «legitimate contradiction findings in a curated, lint-ON KB (e.g. a customer's)». Den regel er rigtig; den er bare ikke finmasket nok til at rydde støjen ved siden af.

## Scope

**F266.1** — ambient-Neuroner mærkes `internal`, hvorefter tærsklen kan sættes
**F266.2** — lint-drænet kan filtrere på TYPE, så modsigelser overlever
**F266.3** — push-indstilling pr. Trail, ikke kun pr. kunde

### Eksplicit UDE af scope

- **At røre buddys auto-godkendelse.** Den virker. 5.730 af 5.777 er allerede godkendt.
- **At hæve eller sænke den globale tærskel på 0,8.** Den er ikke målt som forkert.
- **En oprydning i de 5.743 dokumenter i buddy-sessions.** Egen sag, egen dag, kræver snapshot først.

## Reuse

Discovery slået op for «push», «notification», «queue»: `@broberg/webpush` ejer selve afsendelsen og bruges allerede af flere repoer. F266.3 rører IKKE afsendelsen — kun hvilke Trails der udløser en. Det er Trails egen datamodel (videnbase-id i præferencerne), ikke en delt primitiv. Intet at genbruge, intet gap at melde.

De to andre er ren Trail-domænelogik (kandidat-politik, vedligeholdelses-endpoint).

## Rollout

Alle tre er additive og fejl-bløde. F266.1 og .2 skal begge MÅLES pÅ PROD før og efter — antallet i køen er tallet der tæller, og det kan aflæses direkte.

RÆKKEFØLGEN ER BINDENDE for F266.1: mærkningen skal være live OG verificeret på en rigtig godkendelse, FØR tærsklen sættes. Omvendt rækkefølge udgiver ~500 private noter, og det kan ikke køres tilbage ved at fjerne tærsklen igen.
