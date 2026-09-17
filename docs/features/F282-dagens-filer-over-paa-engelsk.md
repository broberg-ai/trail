# F282 — Dagens 22 nye filer over på engelsk

**Status:** In progress · 17/9 2026 · direkte ordre fra Christian

## Hvorfor nu

Christian godkendte kl. 22:58 en global beslutning: kode, kommentarer, filnavne,
URL'er, API-felter og ruter skrives på **engelsk**. Dansk hører til i UI-tekst,
i svar til ham, i commit-beskeder og i plan-docs som denne.

Beslutningen gælder ny og rørt kode. Alt hvad jeg lavede i dag er nyt, og det
er skrevet på dansk hele vejen igennem.

Jeg anbefalede at gøre det nu frem for stykvis, og han sagde ja. Begrundelsen
er tidspunktet, ikke princippet:

- Det er 22 filer, ikke 1.633. Registret afviser en stor omskrivning af hele
  kodebasen, og det er en anden opgave end denne.
- Alle prøver er grønne lige nu. En omdøbning er kun farlig når man ikke kan
  se om man brækkede noget.
- Filerne er skrevet i dag, så betydningen af hvert navn er kendt. Om tre
  måneder skal den næste læser gætte.

## Hvad der ikke røres, og hvorfor

**Migrationsfilerne er frosne.** `packages/db/src/migrate-runner.ts:103` regner
et sha256-aftryk over filens fulde SQL-indhold — kommentarer inklusive — og
springer migrationen over hvis aftrykket allerede står i databasen. Retter man
en kommentar, ændres aftrykket, migrationen ser ny ud, og `ADD COLUMN` brækker
på en database hvor kolonnen allerede findes.

Det gælder også filnavnet: journalens `tag` peger på det.

`0059_kanon_kontakter.sql` beholder derfor både sit navn og sine danske
kommentarer. Kolonnerne selv er allerede engelske — `new_version_is_canon`,
`canon_off_connectors`, `source_changed_at`, `content_fingerprint` — så der er
ingen databasesændring i denne opgave overhovedet.

**Plan-docs og commit-beskeder bliver på dansk.** Christians egne ord i dag.
De har ham som læser.

**Kortets titel og AC bliver på dansk.** Samme grund.

## Non-goals

- **Ingen ændring af adfærd.** Det her er udelukkende navne og kommentarer.
  Ender en prøve med at måle noget andet bagefter, er det en fejl, ikke en
  forbedring.
- **Ingen oprydning i forbifarten.** Ser jeg noget der kunne skrives bedre,
  bliver det liggende. To ændringer i samme omblæring kan ikke skilles ad
  bagefter.
- **Resten af Trails danske kode røres ikke.** Kun de filer der blev lavet i
  dag. Resten følger reglen «rører du filen, retter du den».

## Reuse

Ingen `@broberg/*`-pakke er involveret. Det er en omdøbning inde i Trails egen
kode, uden ny funktionalitet og uden nye afhængigheder. Intet at genbruge og
intet nyt at dele.

## Spærren

Den eksisterende prøvesuite ER spærren. Før: 421 grønne. Efter skal der stå
421 grønne — samme tal, ikke bare «grønt». Falder antallet, er en prove´fil
holdt op med at blive fundet, og det ville se ud som succes.

## Historier

- **F282.1** — omdøb filer og navne, uden at ændre adfærd.
