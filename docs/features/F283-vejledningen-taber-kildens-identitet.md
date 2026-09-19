# F283 — Vores egen vejledning sender filer ad den rute der taber deres identitet

**Status:** In progress · 19/9 2026 · **fundet af buddy**, ikke af os

## Hvad der er galt

Trails CLAUDE.md peger ikke-interaktive skrivere mod
`POST /api/v1/queue/candidates`. To steder:

  linje 202  «Scripts, CI hooks, anything non-interactive»
  linje 632  «Ikke-interaktivt (CI/scripts)»

For en éngangs-note er det rigtigt. **For en FIL der sendes igen når den rettes,
er det forkert — og det står dokumenteret som den rigtige vej.**

## Hvorfor det er farligt

Målt i vores egen kode:

- `CreateQueueCandidateSchema` (packages/shared/src/schemas.ts:387) har **intet
  identitets-felt**. Felterne er knowledgeBaseId, kind, title, content, metadata,
  confidence, impactEstimate, targetDocumentId, actions.
- `identityOfSource()` (packages/core/src/queue/candidates.ts) arver identiteten
  fra et KILDE-DOKUMENT via `sourceDocumentId`. Uden det: `null`.

En kandidat postet direkte får altså `sourceIdentity = null`. Og den sikre
standard i modsigelses-linten er med vilje **«ingen identitet ⇒ MODSIGELSE»**
(F275.3 AC#4). Så anden gang den samme fil sendes ind i rettet stand, læser
linten de to udgaver som to forskellige kilder der er uenige.

Det er præcis den oversvømmelse F275 blev bygget for at fjerne — og som ramte
ejerens telefon med 100 notifikationer 16/9. Vejledningen leder den næste
skriver lige ind i den igen.

## Hvorfor det ikke er blevet opdaget

Fordi rådet er RIGTIGT til det det oprindelig blev skrevet til. F39's tre
transporter handler om éngangs-takeaways: en beslutning, en diagnose, en
lektie. Den slags sendes én gang og rettes aldrig, så identiteten er ligegyldig.

Skellet er ikke «interaktiv vs ikke-interaktiv», som tabellen siger. Det er:

  en NOTE       sendes én gang          → kandidat-ruten er fin
  en FIL        sendes igen når rettet  → SKAL have en identitet

buddy fandt det mens de byggede memory-fil-transporten (buddy-F353), efter at
jeg havde målt hullet og sendt det til dem. De vendte det om og pegede på at
vejledningen er vores, ikke deres.

## Rettelsen

Begge passager får skellet skrevet ind, med konsekvensen og ikke kun reglen.
Upload-ruten (`?localCompile=true`) navngives som vejen for filer, fordi den
stempler `path:`-identiteten selv (uploads.ts, `uploadIdentity()`).

### Non-goals

- **Vi ændrer ikke kandidat-ruten.** Den er rigtig til det den findes til.
  At tilføje et identitets-felt dér er en selvstændig beslutning med sine egne
  konsekvenser for hvem der må sætte en identitet.
- **Vi retter ikke de andre 29 repoers kopi.** Linje 632 står i den kanoniske
  blok cardmem distribuerer; kun de kan rette den for flåden. Vi melder det.

## Reuse

Ingen `@broberg/*`-pakke er involveret — det er vores egen dokumentation og
vores eget API. Intet at genbruge, intet nyt at dele.

## Historier

- **F283.1** — skriv skellet ind begge steder, og meld den kanoniske blok til
  cardmem.
