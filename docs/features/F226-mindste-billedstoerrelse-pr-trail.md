# F226 — mindste billedstørrelse pr. Trail

**Kort:** trail-F226 · epic · high

> Ejeren, 3. september 2026: *"Så skal vi have lavet en Setting for den enkelte
> trail for hvor små billeder der helt skal sorteres fra og ikke sendes ind i DB
> under extraction/compilation."*

## Gevinsten er ikke plads — og det ændrede hvad der skal bygges

Sannes KB, 1.557 billedrækker:

| | antal | fylder |
|---|---|---|
| **under 50×50 px** | **545 (35 %)** | **0,7 MB** |
| 50×50 – 200×200 | 322 | 20 MB |
| over 200×200 | 690 | 1.935 MB |

En tredjedel af alle rækker er punkttegn, streger og logo-stumper løftet ud af
PDF'er — og tilsammen er de **0,03 % af pladsen**. Et størrelsesfilter køber
således næsten ingen disk.

**Det køber at vi holder op med at køre vision-beskrivelser over 545
meningsløse billeder, og at billedsøgningen ikke fyldes med dem.**

## Derfor måles der i PIXELS, ikke bytes

En fil på 1 MB kan være et dårligt gemt 20×20-ikon; en fil på 2 KB kan være en
meningsfuld 400×400 stregtegning. **Bytes måler den forkerte egenskab.**

## Standardværdien er målt, ikke valgt

Og den er efterprøvet mod hvad vores **egen vision-model** fandt værd at
beskrive:

```
 tærskel   frafiltreret     heraf MED vision-beskrivelse
   16 px   480 (31 %)        0
   24 px   525 (34 %)        1
   32 px   560 (36 %)        1
   48 px   646 (41 %)        1
   64 px   690 (44 %)        2      ← knækpunktet
   96 px   746 (48 %)       21
  128 px   827 (53 %)       78

  1.557 billeder i alt, heraf 420 med en vision-beskrivelse
```

Ved **64 px** smides 44 % af rækkerne væk og vi mister **2 ud af 420**
beskrivelser — 0,5 %. Over den grænse begynder vi at kassere billeder modellen
**selv** fandt værd at skrive om.

Det er et bedre argument for en standardværdi end et rundt tal, fordi det er
systemets egen døm og ikke min.

## Hvor filteret bor

`persistImagesFromExtraction()` i `apps/server/src/services/document-images.ts`
er det ene sted alle udtrukne billeder passerer, og den returnerer allerede
`{ inserted, skipped }`. **Ét filter dér dækker pdf, docx og alle andre
pipelines** uden at røre dem.

Et filter i pdf-stien alene ville være usynligt for docx — den slags halve
spaerre er præcis det denne uges F219 brugte en dag på at rydde op i (syv kopier
af samme funktion i fem udgaver).

## Det springes over med vilje

**De 545 rækker der allerede findes, slettes ikke her.** Det er en
data-migrering i en kundes levende Trail og hører sammen med F225, som allerede
venter på ejerens go til netop den slags skrivning.

Dette kort ændrer hvad der sker **fremover** — og det kan rulles tilbage ved at
ændre en indstilling.

## Det der skal bevises

At tallet falder er nemt at opnå og nemt at snyde med. De bærende kriterier er
derfor:

- **En KB uden værdi opfører sig præcis som i dag.** Ingen eksisterende Trail
  må skifte adfærd i stilhed.
- **Grænsen er `>=`, ikke `>`** — et billede på præcis 64×64 beholdes, bevist
  frem for antaget.
- **Mindste side, ikke areal.** En 2000×10 skillestreg har et stort areal og
  ville slippe igennem et areal-filter. Mutationen der bytter dem om, skal gøre
  en prøve rød.
- **Frasorterede billeder tÆLLES.** «filtrerede 690 små billeder» og
  «udtrækningen fandt ingenting» må aldrig ligne hinanden — det er husets
  gennemgående fejlform, og den ville være nem at genskabe netop her.
