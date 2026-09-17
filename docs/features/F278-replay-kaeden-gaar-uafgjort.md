# F278 — Replay-kæden går uafgjort på sit eget tidsstempel

**Kort:** trail-F278 · epic · **høj**
**Fundet:** 17. september 2026, under F275.3 — førstehånds, og ved et uheld

---

## Hvad der skete

F275.3 skulle melde det når en maskinel genkompilering skriver hen over en
Neuron et menneske har rettet i. Detektionen spurgte om den SENESTE hændelse på
siden:

```ts
.orderBy(desc(wikiEvents.createdAt))
.limit(1)
```

Beskeden udeblev. Intet fejlede. Prøven var rød uden at pege på noget.

En sonde der printede alle hændelser på dokumentet gav svaret:

```
{ eventType: 'created', actorKind: 'llm',  newVersion: 1, createdAt: '2026-09-17 14:40:15' }
{ eventType: 'edited',  actorKind: 'user', newVersion: 2, createdAt: '2026-09-17 14:40:15' }
```

**Samme sekund.** `wiki_events.created_at` er `datetime('now')` — sekund-opløsning
— og SQLite har ingen forpligtelse til at vælge en bestemt række når `ORDER BY`
går uafgjort. Den valgte maskinens `created`. Altså: «den seneste hændelse» var
den ÆLDSTE af de to.

## Hvorfor det er værre end en enkelt manglende besked

Den samme funktion — `lastEventIdFor()` i
`packages/core/src/queue/candidates.ts:342` — leverer `prevEventId` til **fire**
kaldesteder (linje 1228, 1300, 1416, 1748). `prev_event_id` er replay-kædens
pegepind: det er sådan historikken ved hvilken hændelse der kom før hvilken.

Går den uafgjort, peger kæden det forkerte sted. Og historikken er præcis det
sted man leder når en rettelse er forsvundet — altså det instrument man bruger
når man i forvejen er i tvivl.

## Hvorfor den ikke blev rettet med det samme

F275.3's eget NYE opslag fik tiebreaket (`desc(sql\`rowid\`)`) og er
mutations-bevist. `lastEventIdFor` blev IKKE rørt: at ændre historik-kædens
semantik hører ikke til det kort, og en rettelse uden en prøve der er rød uden
den ville være en stille ændring af noget load-bearing. Det er hvad dette kort
er til.

## Rettelsen

```ts
.orderBy(desc(wikiEvents.createdAt), desc(sql`rowid`))
```

`rowid` er indsættelsesrækkefølge og kan ikke gå uafgjort. Tidsstemplet bliver
ved med at være den primære nøgle, så rækker der ER skrevet i forskellige
sekunder sorteres stadig på tid — det er hvad den negative kontrol beskytter.

## Afgrænsning

**I kortet:** den ene funktion, dens fire kaldesteder, prøverne, og en måling af
hvor mange dokumenter i produktionen der faktisk har to hændelser i samme sekund.

**Non-goals:**

- **At give `created_at` millisekunder.** Det ville være den rigtige langsigtede
  rettelse og er en migrering af en kolonne fire ting læser. Den hører ikke her.
- **At reparere historik der allerede peger forkert.** Vi ved ikke hvilke rækker
  det er uden målingen, og en oprydning uden det tal ville være et gæt der ser
  ud som en reparation.

## Den generelle form

Dette er husets tilbagevendende fejl, denne gang i et sorteringskriterium: **en
værdi med for grov opløsning brugt som nøgle, hvor det forkerte svar ser præcis
lige så gyldigt ud som det rigtige.** Der var ingen fejl, intet log-spor, og
funktionen returnerede en rigtig hændelse — bare den forkerte.

## Stories

| # | | |
|---|---|---|
| F278.1 | Tiebreak på rowid i lastEventIdFor, med en prøve der er rød uden den | høj · 2 SP |
