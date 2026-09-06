# F259 — opstarten må ikke lade én kundes vedligeholdelse vælte alle kunder

**Status:** shipped (6. september 2026) · **Kind:** story

## Motivation

Ejeren, 6/9: *«Kræver det en større maskine eller er koden bare rotten!»*

Svaret var koden. Produktionen lå i et nedbruds-loop.

**Målt på produktion, ikke udledt:**

```
12:17:43  åbner REMOTE tenant DB: broberg-ai
          ← 283 sekunders TAVSHED
12:22:26  Main child exited normally with code: 1
12:22:26  reboot: Restarting system              (308 s oppetid)
```

Fly-proxyen svarede `instance refused connection … 0.0.0.0:8080` i fire
minutter ad gangen. Motoren begyndte **aldrig** at lytte.

## Root cause

`bootTenant` kørte **femten opgaver i én sekventiel kæde**, i en top-level
`await` **før** `Bun.serve` — og `openTenantPool` kørte hele kæden igen for
**hver** kunde.

Tolv af de femten er idempotent vedligeholdelse (backfills, oprydninger,
kredit-påfyldning) der walker hele basen. broberg-ai har 7.217 Neuroner på den
anden side af netværket. Den hang, kastede en timeout, og **en afvist
top-level await afslutter processen i Bun**.

Så én kundes vedligeholdelse tog alle tre kunder ned. Sanne og fd-aalborg var
klar til at betjene længe før — de ventede på broberg-ai.

### Hvorfor F258 ikke reddede det

F258 (`process.on('unhandledRejection')`) blev udrullet som fixet på
nedbruds-loopet. **Den virkede ikke her.** Vagten installeres efter
`Bun.serve`, og processen døde før den nåede dertil.

> En vagt der står bag ved fejlen ser rigtig ud i koden og har ingen virkning
> i praksis.

F258 står ved magt for det den faktisk dækker — en fejning der fejler *efter*
opstarten.

## Arkitektur

Rettelsen er den **F222.3 allerede havde argumenteret for** og kun gennemført
for link-fejningerne: det der ikke er en forudsætning for at betjene, hører
ikke til før serveren lytter.

| | indhold | hvornår |
|---|---|---|
| `bootTenantEssential` | migrations · FTS · ingest-user | **før** `Bun.serve` |
| `bootTenantMaintenance` | de 12 resterende | **efter** `Bun.serve`, pr. kunde |

De tre essentielle er skema-operationer der **ikke skalerer med basens
størrelse**. Vedligeholdelsen flytter ind i `bootTenantDeferred`, som allerede
kørte pr. kunde efter serveren lytter og allerede fangede fejl uden at vælte
motoren.

`provisionTenant` beholder hele sekvensen under ét: dér er basen splinterny og
tom, vedligeholdelsen er øjeblikkelig, og en ny kunde må gerne vente på at hans
egen base er helt klar.

### Tidtagning pr. trin

De 283 sekunder var **tavse**. Loggen kunne ikke sige hvilket af femten trin
der hang, så diagnosen ville have kostet ét nedbrud pr. gæt. Hvert trin over
ét sekund skriver nu sit navn og sin tid: `[boot] broberg-ai/migrations: 4s`.

## Spærren (harness-kontrakt)

`apps/server/src/boot-order.test.ts` læser `index.ts` og går **rød** hvis en af
de tolv vedligeholdelses-opgaver kaldes før `Bun.serve`.

**Mutations-bevist:** flyttes `backfillContentHash` tilbage over `Bun.serve`,
går prøven rød og navngiver den (5 pass / 1 fail).

Prøven læser kilden **med vilje**: `index.ts` *er* opstarten, så at importere
den åbner databaser, starter timere og lytter på en port. Egenskaben der skal
bevogtes er en rækkefølge i modulets top-level, og den kan læses direkte. En
prøve der ikke kan læse det den skal bevogte, beviser noget andet.

Den har **negativ kontrol mod sig selv**: en prøve der tjekker at alle tolv
navne stadig findes i filen, så en stavefejl i listen ikke gør «ingen syndere»
grøn.

## Non-goals

- **Ikke en større maskine.** Maskinen var ikke problemet; en sekventiel kæde
  bliver ikke kortere af flere kerner.
- **Rører ikke beslutningen om at en fejlet DB-åbning skal fejle opstarten**
  (`tenant-pool.ts`). Den er bevidst og handler om ikke at falde tilbage på en
  forældet base. Det målte nedbrud lå i vedligeholdelsen, ikke i åbningen.
- Gør ikke den enkelte vedligeholdelses-opgave hurtigere. Den må tage den tid
  den tager — ingen kunde venter på den længere.

## Åbent efter denne rettelse

- **Hvilket af de tolv trin bruger de 283 sekunder?** Tidtagningen svarer på
  det ved næste opstart. Indtil da er det ikke målt.
- **Flys sundhedstjek har 5 sekunders tålmodighed.** Med vedligeholdelsen ude
  af serverings-vejen bør motoren svare hurtigt — men det skal måles, ikke
  antages.
