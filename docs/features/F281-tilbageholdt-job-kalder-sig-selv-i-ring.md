# F281 — Et tilbageholdt kompileringsjob kalder sig selv i ring

**Status:** In progress · fundet 17/9 2026 under F275.6 · **ikke** en fejl i F275.6

## Hvad der sker for produktet

Når Trail har travlt — flere kilder kompilerer samtidig og den globale
kapacitetsgrænse er nået — skal det næste job vente pænt i køen til der bliver
plads. Det gør det ikke. Det spørger om lov, får nej, og spørger igen med det
samme. I ring. Uden pause.

**Målt 17/9 2026 på serverens egen prøvesuite:** ét tilbageholdt job skrev
**686.041 linjer** «[backpressure] holding job_193f85c0-1b7 …» og en logfil på
**62 MB** på få sekunder. Suiten nåede aldrig at blive færdig; den blev dræbt.
En tidligere kørsel samme dag nåede 2.576.392 linjer.

I produktionen betyder det: én CPU-kerne på fuld drøn og en logstrøm der
drukner alt andet, netop i det øjeblik systemet i forvejen er presset. Det er
den dårligste tænkelige timing — spærren der skal beskytte mod overbelastning
er selv det der belaster.

## Hvorfor det ikke er blevet opdaget før

Fejlen kræver at kapacitetsgrænsen faktisk bliver ramt. I den daglige drift
sker det sjældent, og i prøvesuiten skete det først da der kom nok samtidige
upload-prøver til at presse den over. Den har ligget latent siden F21.

Den blev fundet fordi den lignede noget andet: jeg troede først det var
Christians Mac der løb tør for hukommelse (det var det ikke — samme maskine
kørte 402 grønne prøver på 10,5 sekunder uden den ene prøvefil), og derefter at
det var F280's parkerings-fejl (det var det heller ikke — den er rettet, og
stormen blev ved).

## Årsagen, i tre linjer kode

`apps/server/src/services/ingest.ts`, funktionen `claimAndRun`:

1. Kapacitetstjekket siger nej → funktionen skriver «holding …» og vender
   tilbage. Jobbet bliver liggende som `queued`. Det er rigtigt.
2. `finally`-blokken kigger så efter «er der mere i kø for denne Brain?» —
   og finder **præcis det job vi lige lagde fra os**.
3. Den kalder `tickScheduler` igen. Med det samme. Som starter forfra på 1.

Drænings-blokken kan ikke skelne «jeg blev færdig med et job, er der flere?»
fra «jeg fik ikke lov at starte, ligger det stadig der?». I det første
tilfælde er et øjeblikkeligt gen-kald rigtigt; i det andet er det en ring.

## Rettelsen

Et tilbageholdt job gen-kalder ikke sig selv. Den **periodiske planlægger**
(`setInterval`, allerede bygget i F21) ejer forsøget igen — det er præcis det
den findes til, og kommentaren over kapacitetstjekket siger det allerede:
«Periodic scheduler re-ticks every 30s».

Konkret: `claimAndRun` husker at den bailede på kapacitet, og drænings-blokken
springer gen-kaldet over i netop det tilfælde. Alle andre udgange — job kørt
færdigt, job annulleret, kø tom — er uændrede.

### Non-goals

- **Vi ændrer ikke kapacitetsgrænserne.** Tallene er ikke problemet.
- **Vi slukker ikke for «holding»-loglinjen.** Den er nyttig én gang pr.
  forsøg; det er gentagelsen der er fejlen. At dæmpe logningen ville skjule
  ringen i stedet for at lukke den — symptom-skjul, forbudt i huset.
- **Vi rører ikke ved den periodiske planlæggers interval.**

## Spærren (harness-kontrakten)

Køen er en bærende kæde: går den i stå, kompilerer ingen kilder. Derfor to
ting, ikke én:

1. En automatiseret prøve der fylder kapaciteten, lægger ét job i kø og
   tæller «holding»-linjerne. Mutations-bevist: fjernes spærren, bliver den rød.
2. En prøve der beviser at det tilbageholdte job **stadig bliver kørt** når
   der bliver plads. En rettelse der stopper ringen ved at tabe arbejdet ville
   bestå prøve 1 og være værre end fejlen.

## Reuse

Ingen `@broberg/*`-pakke ejer en job-kø eller en kapacitetsspærre — søgt på
Discovery for «queue», «backpressure», «concurrency» før planen blev skrevet.
Det her er Trails egen motor (F21), og rettelsen er tre linjer i den. Der er
intet at genbruge og intet nyt at dele.

## Afhængigheder

Ingen. Rettelsen er selvstændig og additiv — ingen migration, ingen ny
konfiguration, ingen ændret opførsel for et job der får lov at køre.

## Historier

- **F281.1** — luk ringen: et tilbageholdt job gen-kalder ikke sig selv.
