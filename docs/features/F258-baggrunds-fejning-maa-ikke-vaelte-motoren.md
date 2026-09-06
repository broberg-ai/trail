# F258 — en baggrunds-fejning må aldrig vælte betjeningen

**Status:** shipped (v168, 6. september 2026) · **Kind:** story

## Motivation

Motoren styrtede med:

```
TimeoutError: The operation timed out.
Main child exited normally with code: 1
[ 308.349265] reboot: Restarting system
```

Fejningerne var pakket i `try/catch`. Det hjalp ikke.

## Root cause

libsql-klientens timeout ankommer som en **afvist promise uden for det `await`
der blev fanget**, og Bun afslutter processen ved en ubehandlet afvisning.

> **En catch dækker den kode den står om — ikke alt det arbejde kaldet satte i gang.**

Derfor er vagten på **processen**, ikke på kaldestedet.

## Scope

**I scope:** `process.on('unhandledRejection')` i `apps/server/src/index.ts`,
placeret efter `Bun.serve` og før de udskudte fejninger sættes i gang.

**Non-goals:**
- **IKKE `uncaughtException`.** Dér kan tilstanden være korrupt, og at køre
  videre er værre end at genstarte. En afvist promise fra et baggrundskald er
  en anden sag — der er intet korrupt, der er bare noget der ikke blev færdigt.
- Gør ikke fejningen hurtigere. Den holder motoren oppe, intet andet.

## Hvad den IKKE dækkede — og det er den vigtige lærdom

**Jeg udrullede F258 som fixet på nedbruds-loopet. Det var den ikke.**

Vagten installeres **efter** `Bun.serve`. Nedbruddet skete i en top-level
`await` **før** `Bun.serve`, så linjen der installerer vagten blev aldrig
udført. Målt på det udrullede image: nøjagtig samme nedbrud, samme 308 sekunder.

> En vagt der står bag ved fejlen ser rigtig ud i koden og har ingen virkning
> i praksis. Det kan man ikke se ved at læse koden — kun ved at måle.

Det egentlige nedbrud er rettet i **F259**. F258 står ved magt for det den
faktisk dækker: en fejning der fejler **efter** opstarten.

## Rollout

Udrullet som v168. Verificeret ved at måle processens levetid i loggen efter
udrulningen — ikke ved exit-koden, som `flyctl` har givet grøn på et fejlet
deploy før i dag.
