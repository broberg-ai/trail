# F265 — Kan vi bevise at hukommelsen bliver brugt?

**Ejerens spørgsmål, 9. september 2026** (via buddy, intercom #26964): har nogen
agent NOGENSINDE slået noget op i Trail for at afgøre hvilken vej den skulle gå
— og kan det bevises?

I dag er svaret nej. Ikke «nej, det er ikke sket» — **nej, det kan ikke afgøres.**
Og uden det tal er hele hukommelsen en påstand.

## De to halvdele, og de hænger sammen

**F265.1 — adgangsloggen.** Hans direkte ordre: ufravigelig logning af alle
eksterne API/MCP-kald. Hvad, hvorfra, hvem. Plus ét felt han ikke bad om —
antal træf — fordi «nogen søgte» og «nogen søgte og fik noget brugbart» er to
forskellige tal, og kun det andet svarer på hans spørgsmål.

**F265.2 — søgerelevansen.** Målt samme dag: en søgning på 7 ord giver 0
relevante træf hvor samme sag på 1 ord giver 3 af 3. Monotont faldende med
forespørgslens længde.

**Rækkefølgen mellem dem er selve pointen.** Bygger vi kun loggen, måler vi et
værktøj der svarer dårligt — og et lavt tal bliver læst som «agenter søger
ikke» i stedet for «agenter søger som mennesker taler, og det straffer
værktøjet». Retter vi kun søgningen, kan vi ikke vise at det hjalp.

## Målingen der udløste det hele

buddy, 354 transskripter, 3,5 måned:

```
gemt         399
slået op      31        forhold 13:1
heraf fra de tre repoer der byggede det:  27
de øvrige 28 repoer:                       0
```

Og det der faktisk når frem er ikke opslag: **26.432 automatiske
hukommelses-injektioner mod 31 bevidste opslag.** 850:1. Agenter *søger* ikke;
de får skudt et nøgleord-lotteri ind i prompten.

## Non-goals for epicen

- **Ikke** at rydde op i korpusset. buddys første diagnose var at det
  værdifulde drukner i 95 % intercom-noter; målingen i F265.2 inverterer det —
  det rigtige dokument ligger der og rangerer nummer ét på en kort forespørgsel.
  En oprydning i 4.321 noter er uigenkaldelig og ville have været måneders
  arbejde mod den forkerte årsag.
- **Ikke** at automatisere mere INDLÆGNING. buddy stillede deres egen
  auto-høst i bero af samme grund: at hælde mere i en brønd ingen kan trække op
  af er den forkerte rækkefølge.
- **Ikke** at logge forespørgslernes tekst. Se F265.1.

## Reuse

Slået op i Discovery før planen (`?q=logging`, `?q=telemetry`, `?q=audit`,
`?q=search`, `?q=ranking`): **ingen `@broberg/*`-pakke dækker nogen af de to
halvdele.** Nærmeste er `@broberg/ai-sdk`'s omkostnings-sink, som måler penge
pr. LLM-kald — en anden akse end adgang. Søgerangering er kerne-domænelogik i
motoren, ikke en delt primitiv. Intet at genbruge, intet gap at melde.