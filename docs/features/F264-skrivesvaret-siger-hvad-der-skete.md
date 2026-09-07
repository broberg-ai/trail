# F264 — Skrive-svaret siger HVAD der skete

> **Foreslået af buddy-sessionen, 7. september 2026:** *«ingest-svaret ved allerede
> ved skrivetidspunktet hvad der skete. Hvis det returnerede udfaldet frem for kun
> status … så kan min kvittering sige «gemt» eller «ligger til review i <base>,
> tærskel 0,8 > 0,7» i stedet for det samme ord hver gang.»*

## Problemet er en basisrate, ikke en løgn

buddys kvittering på `trail_save` siger i dag:

> «Saved PENDING CANDIDATE to trail (…). Christian reviews in admin Queue tab.»

**Den er sand hver eneste gang.** Der er ingen unøjagtighed at rette. Og alligevel
virker den ikke, og det er værd at forstå præcist hvorfor.

Målt 7. september på broberg-ai:

```
buddy-kandidater auto-godkendt   5.664
buddy-kandidater der ligger         47
afvist nogensinde                    2
```

**~99 % af de «pending» er pending i cirka et sekund.** Derfor kalibrerer
læseren — menneske eller agent — ordet til at betyde «det er fint». Og så bærer
det ingen information netop i de 1 % hvor det betyder noget.

> Det er ikke en fejl i teksten. Det er en basisrate der gør en sand tekst
> uinformativ — og den kan derfor ikke rettes ved at gøre teksten mere præcis.

buddy overvejede at omskrive ordlyden og lod være, med den rigtige begrundelse:
en kvittering der siger «lagt i kø» og en kø der ikke drænes er et
gennemløbsproblem, ikke et ærlighedsproblem — og at pynte på teksten ville skjule
det.

## Løsningen ligger på vores side

Udfaldet er kendt i skriveøjeblikket. `packages/core/src/queue/candidates.ts`
returnerer allerede `autoApproved: boolean` internt. Det når bare aldrig ud
gennem HTTP-svaret, så kalderen kan kun se at kandidaten blev modtaget.

```
{ candidateId, outcome: "auto-approved" | "queued-for-review", confidence, threshold }
```

Det er en **gennemføring**, ikke en ny udledning. Ingen ny regel, intet nyt
opslag, ingen adfærdsændring.

## Hvorfor kalderen ikke bare slår det op selv

buddy tilbød at udlede udfaldet ved selv at læse tærsklen, og afviste det i samme
åndedrag — korrekt:

> *«at gætte udfaldet ud fra en tærskel jeg selv slår op, ville være en ny kopi af
> en regel I ejer, og den ville drive.»*

En godkendelsesregel i to kopier er ikke gal den dag den skrives. Den er gal den
dag den ene bliver rettet. Derfor bærer **svaret** udfaldet.

## Åbent spørgsmål dette kort IKKE løser

Hvad skiller de 47 fra de 5.664? Målt, og den oplagte hypotese er **afvist**:

| | |
|---|---|
| videnbase | **alle** i `buddy-sessions` — samme base |
| konfidens | **alle 47 har 0,7**; de godkendte spænder 0,7–0,9 |
| tærskel pr. base | kan ikke diskriminere — samme base har både godkendt og tilbageholdt 0,7'ere |
| tidsrække | 2/7 – 5/9, altså **ikke** ét sammenhængende nedetids-vindue |

Forklaringen ligger et andet sted, og den er ikke fundet. Dette kort gør blot
udfaldet synligt **fremadrettet**, så det næste tilfælde opdages i sekundet frem
for efter to måneder. Det er med vilje den mindre af de to opgaver: en diagnose
kan vente, en blind kvittering bør ikke.

## Scope

**I scope:** `outcome`, `confidence` og `threshold` på svaret fra
`POST /queue/candidates` og `/wiki-write`.

**Non-goals, eksplicit:**

- **Ingen ændring af hvem der godkender hvad.** En kandidat der auto-godkendes i
  dag, auto-godkendes bagefter. Kortet gør udfaldet synligt, ikke anderledes.
- **Ingen dræning af de 47.** De er Christians at gennemgå.
- **Ingen omskrivning af buddys kvitteringstekst.** Det er deres halvdel, og de
  bygger den når feltet findes — ikke mod et tilsagn.

## Reuse

Discovery gennemsøgt for «write outcome», «approval result», «queue receipt» —
ingen `@broberg/*`-pakke dækker det. Feltet ligger tæt på Trails egen
kø-datamodel og hører hjemme i motoren. Genbruges: `autoApproved` fra
`packages/core/src/queue/candidates.ts`, som allerede bærer sandheden.

## Rollout

Additivt felt, ship dark. En eksisterende kalder der ikke kender `outcome` skal
virke uændret — bevist ved at køre den nuværende `/local-ingest`-vej igennem
uden ændringer. buddy bygger sin halvdel når feltet er i drift.

## Stories

| | |
|---|---|
| **F264.1** | `outcome` på begge skrivedveje, additivt |
