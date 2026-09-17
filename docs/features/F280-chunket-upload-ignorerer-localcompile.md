# F280 — Den chunk-delte upload ignorerer «parker til gratis kompilering»

**Kort:** trail-F280 · epic · **høj**
**Fundet:** 17. september 2026, førstehånds, mens F275.6's prøver låste hele serverens suite

---

## To søskende-veje, ét flag, kun den ene ærer det

```
uploads.ts:462   if (isText && !localCompile) triggerIngest(...)   ← enkelt-POST, korrekt
uploads.ts:1203  if (isText)                  triggerIngest(...)   ← chunk-delt, ubetinget
```

Og `/upload/init` læser slet ikke `?localCompile` — så selv en klient der sender
flaget korrekt får en kilde der hverken er parkeret (`awaiting_local_compile`
forbliver falsk) eller fri for en sky-kompilering.

## Hvorfor det betyder noget

F191's hele formål er **$0-invarianten**: en kilde parkeres og kompileres gratis
i en kørende cc-session på Max-abonnementet, i stedet for på en betalt sky-model.
Et flag der kun virker ad den ene vej er en regning der kommer uden en beslutning
bag.

## DET BIDER IKKE I DAG — og det er en del af fundet

Målt før påstanden blev skrevet:

```
apps/ingest-station/src/api.ts:106   `?localCompile=true${force ? '&force=true' : ''}`
                                     → POST /documents/upload   (ENKELT-POST)
```

Ingest Station — den eneste flade der sender flaget — bruger enkelt-POST'en, som
gør det rigtige. Så **ingen har betalt for noget de bad om gratis.**

Defekten er **latent**: den bider den dag nogen flytter Station til den
chunk-delte vej (naturligt for store filer, som er netop dens formål), eller
tilføjer flaget i admin-panelets dropzone. Og den ville bide **tavst** — en
sky-kompilering ser ud som en vellykket kompilering.

## Hvordan den blev fundet

Ikke ved at læse koden. F275.6's nye prøvefil uploadede tre filer ad den
chunk-delte vej, hver udløste en kompilering der ikke kunne fuldføres i test, og
serverens suite gik fra **402 grønne på 10,5 sekunder** til at skrive
**2.576.392 linjer «[backpressure] holding job_…»** uden at få én prøve færdig.

Jeg troede først det var maskinens hukommelse — swappen stod på 92 % — og sagde
det til ejeren. Det var forkert: en kørsel med ÆNDRINGERNE men UDEN prøvefilen
gav 402 grønne på 10,5 sekunder på samme maskine. **Symptomet lå i det lag jeg
kiggede i; årsagen lå et lag under.**

## Afgrænsning

**I kortet:** `/init` læser `?localCompile` og sætter `awaiting_local_compile`;
finalize får samme spærre som sin søskende. Prøver der er RØDE uden rettelsen.

**Non-goals:**

- **At ændre enkelt-POST'en.** Den gør det rigtige.
- **At flytte Ingest Station til den chunk-delte vej.** Et andet spørgsmål.
- **At dæmpe backpressure-loggen.** Den skrev 2,5 mio. linjer og var dét der
  gjorde fejlen synlig. En støjdæmpning her ville have gjort næste forekomst
  usynlig.

## Stories

| # | | |
|---|---|---|
| F280.1 | Begge upload-veje ærer localCompile — bevist på hver sin prøve | høj · 2 SP |
