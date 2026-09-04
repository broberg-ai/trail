# F243 — upsert på kilde-URL: gen-push opdaterer, dublerer ikke

**Kort:** trail-F243 · epic · high
**Bestilt:** Christians GO 4/9, ordret via cms: «Ja tak til overskrivning-på-URL».

## Hvorfor

broberg-ai-sitet synker 103 CMS-sider (+ Christians 9 egne kilder) ind i Aidans
viden-KB via `POST /knowledge-bases/:kb/documents/upload`. Hver side bærer
`metadata.sourceUrl` (connector `broberg-ai-site-sync`). I dag opretter et
gen-push af en RETTET side et NYT dokument — så en re-sync efter en
artikel-rettelse fordobler KB'en, og Aidan citerer den gamle udgave side om
side med den nye.

Forbrugerens bevis-krav, deres egen formulering: *«push af en uændret side må
give 0 nye dokumenter.»*

## Adfærden, præcist

Nøglen er `(tenant, KB, metadata.sourceUrl)` på aktive kilde-dokumenter.

| situation | svar | virkning |
|---|---|---|
| sourceUrl ny i KB'en | **201** som i dag | nyt dokument |
| sourceUrl findes, samme bytes (contentHash ens) | **200** + `upsert:"unchanged"` | INTET ændres — ikke engang updatedAt. 0 nye dokumenter |
| sourceUrl findes, ændrede bytes | **200** + `upsert:"updated"` | SAMME dokument-id · nye bytes i lageret · rækken opdateret (indhold, titel, hash, størrelse, version+1, status processing) · chunks SLETTET og genopbygget (mønstret fra documents.ts:482) · kompilering gen-udløst |
| intet sourceUrl i kaldet | uændret adfærd, inkl. F162-dublet-409 | — |
| samme bytes men ANDEN sourceUrl | uændret F162-adfærd (409 duplicate_source) | to URL'er med ens indhold er stadig en beslutning for mennesket |

**Dokument-id'et er stabilt** — det var cms' ønske, så de aldrig skal bogføre
`targetDocumentId`. Version tæller op, så historikken kan ses.

**Flere matches på samme sourceUrl** (mulige via ?force=true historisk): den
NYESTE opdateres, og svaret navngiver antallet (`upsertMatches: n`) så en
unormal tilstand er synlig frem for stiltiende valgt væk.

## Hvad der BEVIDST ikke gøres

- **Gamle Neuroner røres ikke.** Chunks (søgningen) udskiftes; kompileringen
  kører igen som ved frisk ingest. Neuroner kurateret fra den gamle udgave er
  viden med egen historik — modsætninger er lint-systemets domæne (F19), ikke
  denne uploads.
- **Ingen skema-ændring.** Opslaget bruger `json_extract(metadata,'$.sourceUrl')`
  — ved 112 dokumenter er et indeks præmatur optimering. Bliver KB'er på
  10.000+ sider virkelighed, er indekset en egen lille story.
- **Gamle lager-bytes ved ændret filendelse** (md → html): nye bytes skrives på
  den nye sti; den gamle blob kan ligge tilbage som forældreløs. Noteret —
  oprydning hører til F225-familien, ikke her.

## Prøverne — og læs-tilbage-reglen gælder chunks

Den bærende påstand er IKKE «svarede 200»: efter et ændret gen-push skal en
søgning på et ord der KUN fandtes i den gamle udgave give 0, og et ord der kun
findes i den nye give træf — begge retninger, ellers er «chunks udskiftet» en
påstand om skrivningen og ikke om det læseren finder. Dokument-antallet i KB'en
hævdes før/efter med streng lighed i alle grene.

## Reuse

Ingen fleet-primitiv for upsert; mønstret (delete chunks → storeChunks) og
F162-hashen findes allerede i repoet og genbruges. Discovery-tjekket fra F242
(4/9) står ved magt: ingen relevante pakker.

## Udrulning

`pnpm ship` — **EFTER at det kørende chunk-job (103 kilder) er færdigt**;
ejerens frost 4/9 gælder til da. Beviset bagefter er cms' egen re-sync:
uændret push af alle sider → 0 nye dokumenter.
