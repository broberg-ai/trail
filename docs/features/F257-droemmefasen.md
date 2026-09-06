# F257 — Drømmefasen

> **Ejeren, 6. september 2026:** *«hvorfor opstår alle de døde links? Er der noget
> galt i ingest eller compile i den retning, det burde ikke være et job nogen skal
> stå for at kurere, der er arbejde nok med at "passe" en second-brain :) Kan hele
> det link oprydningsarbejde ikke ske automatisk, måske når vi "Dreaming" om natten
> — så vi reelt set slet ikke har behov for siden?»*

**Kort svar: ja, på 60 % med det samme og på ~95 % når kompileringen er rettet.
Og ja — der ER noget galt i compile.**

## De 328 brudte links, kategoriseret

Målt på broberg.ai-basen, ikke anslaaet:

| | antal | andel | hvad det er |
|---|---:|---:|---|
| **A** | 55 | 17 % | **opløses allerede** — rapporten er forældet |
| **B** | 142 | 43 % | **fejlfødte navne** (F256) — ren defekt |
| **C** | 92 | 28 % | tæt på en Neuron der findes |
| **D** | 39 | 12 % | Neuronen findes **slet ikke** |

**A + B = 60 % kræver ikke et eneste skøn.** De er ikke kuratering; de er
oprydning efter to fejl.

### A — rapporten rydder ikke op efter sig selv

55 af fundene peger på links der **virker i dag**. Findings-tabellen ryddes ikke
når et link begynder at opløses — den vokser kun. En sjettedel af siden er altså
støj om løste problemer, og det er også derfor siden føles som et job der aldrig
bliver færdigt.

### B — F256, allerede rettet ved kilden

26 Neuroner blev født med en sti eller et filnavn som titel. Rettet i skrivevejen
6/9; de eksisterende repareres i F256.2.

### C og D — HER er ejerens mistanke rigtig

**Kompileringen citerer noget den ikke skriver.** Den beslutter at nævne
`[[Ejer dine data]]` og beslutter så — helt legitimt, prompten siger «Ikke sider
for trivielle begreber» — ikke at skrive den Neuron. Linket bliver stående.

C er samme fejl en tak finere: den citerede **en lidt anden titel end den skrev**.

```
skrev:   «ChatGPT sælger annoncer fra på mandag — broberg.ai»
citérede: «ChatGPT begynder at sælge annoncer på mandag — broberg.ai»
```

Begge er compile-side, og **de er hvor arbejdet skal stoppe med at opstå** — ikke
hvor det skal ryddes op bagefter.

## Rettelsen, i den rækkefølge der betyder noget

**1. Kompileringen løser sine EGNE links før den er færdig (F257.1).**
Efter skrivningen: opløs hvert `[[link]]` du selv har skrevet. Kan det ikke
opløses, så enten **skriv Neuronen** eller **fjern klammerne**. Det er den ene
ændring der får C og D til at holde op med at opstå — 40 % af tilgangen.

Det er samme princip som resten af huset: reglen hører i koden, ikke i prompten.
Kompilerings-prompten siger allerede at links skal opløse; en model der er uenig
med sig selv fra gang til gang håndhæver den ikke.

**2. Drømmefasen rydder op om natten (F257.2).** Når trafikken er lav:

```
a. genscan   → luk fund hvis link nu opløses          (A: 55, nul skøn)
b. reparer   → fejlfødte navne fra frontmatter        (B: 142, nul skøn)
c. FORESLÅ   → nær-træf som kandidater i den kø han allerede læser  (C)
d. FORESLÅ   → manglende Neuroner som «skal denne skrives?»          (D)
```

**3. Siden kan forsvinde (F257.3).** Ikke fordi problemet forsvinder, men fordi
resten hører hjemme i **kandidat-køen han allerede gennemgår** — med godkend/afvis,
konfidens og proveniens. En separat side med sin egen arbejdsgang er en anden
indbakke at holde øje med.

## Det der IKKE må automatiseres — og hvorfor

**En genpegning må aldrig GÆTTE et mål.**

Et dødt link er **synligt dødt**. Et link der peger på den forkerte Neuron ser
rigtigt ud, og det siger «denne påstand er underbygget af DEN Neuron». Vi ville
have byttet et synligt hul for en falsk proveniens — i en hjerne hvis hele
produkt-løfte er at man kan gå tilbage og se hvad en påstand hviler på.

Samme begrundelse som i F252.3, hvor automatisk genpegning blev forkastet af
nøjagtig samme grund. Det er ikke forsigtighed; det er at den billige fejl og
den dyre fejl ligger i hver sin retning.

Derfor: drømmefasen **foreslår** C og D, den **afgør** dem ikke. Mennesket ser et
fardigt forslag med ét klik, ikke en opgaveliste.

## Non-goals

- **Ingen ændring af link-opløseren.** Den gør det rigtige; den blev født forkerte
  data. At lære den at matche løsere ville skjule fejlen og gøre enhver fremtidig
  fejlfødsel usynlig.
- **Ingen sletning af `[[klammer]]` i eksisterende Neuroner.** Et dødt link er en
  oplysning om at noget mangler. Fjernes det, forsvinder oplysningen også.
- **Drømmefasen er ikke en generel natjob-ramme.** Kun link-hygiejne her; et
  bredere «vedligehold om natten» er en egen beslutning.
