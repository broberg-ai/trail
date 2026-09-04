# F229 — et billede der ikke forestiller noget må aldrig ind i en Trail

**Kort:** trail-F229 · epic · high
**Stories:** F229.1 entropi-porten · F229.2 OCR på det der overlever · F229.3 oprydning af det der allerede ligger der

## Hvorfor — ejeren åbnede billedet, og jeg havde ikke

Jeg pegede på et billede i Sannes Trail og sluttede fra **416×439 og 714 KB**
at der var «rigtigt indhold» i det. Ejeren åbnede det:

> *«Men har du SET billedet? Det er en STOR lyseblå klat farve. Det forestiller
> INTET. Hvis en billig (MEGET BILLIG) vision model ikke kan få noget
> forståelse ud af motivet på billedet så skal det discardes. Vi skal IKKE
> bruge Anthropic til noget af det.»*

**Det væltede F226's præmis.** F226 filtrerer på STØRRELSE, og størrelse er en
stedfortræder for indhold der ikke holder: klatten er stor nok til at slippe
gennem enhver pixelgrænse vi kunne finde på at sætte, og den er et billede af
ingenting. Et 20×20-punkttegn og en 2973×1887 ensfarvet flade er det samme
problem i to størrelser.

**Målt 4. september på Sannes 1.557 billeder** (`verify-f229-entropy.ts`):

```
entropi                     antal        MB     beskrevet
under 0,5  (ensfarvet)        326      12,5             3
0,5 - 1,5                     108      92,2            24
1,5 - 3,0                     340     320,3           143
3,0 - 5,0                     196     114,6            36
over 5,0   (rigt indhold)     353     365,0           192

målt 1323 · IKKE MÅLBARE 234   (212 × http 404, 22 × http 502)
ensfarvede der overlever 32 px:  57
ensfarvede der overlever 64 px:  18
ensfarvede der overlever 72 px:  17
største ensfarvede: 1438x1294, 7,4 MB, i ÉN farve
uden vision overhovedet: 925 af 1323 (70 %)
```

**326 billeder — hvert fjerde af dem vi kan måle — er en ensfarvet flade.** 17
af dem slipper gennem den 72 px-grænse jeg selv anbefalede.

**De 234 ikke-målbare er ikke støj — de er et selvstændigt fund.** De 212
http-404'ere er nøjagtigt de 212 rækker hvis `filename` starter med en skråstreg
(`/page-1-img-11.png`), så deres URL får en dobbelt skråstreg og ikke kan
hentes. Det er en anden fejl end denne, og den har fået sit eget kort.

**Og det er præcis derfor proben har tre udfald og ikke to.** En tidligere
udgave af den samme probe talte netværksfejl som «manglende billede» og gav to
forskellige tal for samme korpus. Havde denne gjort det samme, ville de 212
brudte links være blevet talt som 212 ensfarvede — og entropi-porten ville have
fået æren for at fjerne noget den slet ikke kan se.

## Hvad entropi er, i produkt-sprog

Et mål for hvor meget **variation** der er i billedets pixels. En flade i én
farve har entropi tæt på 0; et fotografi eller et diagram har 5+. Det er ikke et
skøn og ikke en model — `sharp` regner det lokalt på bytes vi allerede har læst.
**Gratis, ingen tokens, ingen data der forlader maskinen.**

Derfor er porten fri, og derfor kommer den FØRST: den fjerner en femtedel af
billederne uden at spørge en model om noget som helst.

## Scope

**I scope:**

| story | |
|---|---|
| **F229.1** | Entropi-porten ved ingest. Et billede uden variation får hverken en række i databasen eller en vision-beskrivelse — og dets bytes slettes fra disken. |
| **F229.2** | **Mistral OCR** (`mistral-ocr-latest`, Paris) på det der overlever, så tekst der står inde i et billede kan søges. Beskrivelse og tekstudtræk er to forskellige ting, og vi har kun haft den første. |
| **F229.3** | Oprydning af de 331 der allerede ligger der — en **knap der viser tallet og beder om et ja**, aldrig automatik. |

**Non-goals:**

- **Vi flytter ikke vision til Anthropic — og vi skal heller ikke væk fra den.**
  Målt: vision kører allerede på **Mistral EU** siden F199.2
  (`mistral-small-latest` primær, `pixtral-large-latest` som reserve, begge
  Paris). Ejerens *«Vi skal IKKE bruge Anthropic»* er allerede opfyldt for
  billeder. Det skrives her fordi mit eget resumé påstod det modsatte.
- Ingen ny model-vælger, ingen ny indstillingsside. Entropi-tærsklen hører
  hjemme ved siden af F226's pixelgrænse, ikke i sin egen flade.
- Vi rører ikke tekst-udtræk fra PDF'er. Kun billeder.

## Arkitektur — én port, ikke én pr. format

Rørføringen i dag:

```
upload → pipeline (pdf/docx/pptx/image)
           ├─ skriver billed-bytes til disken
           └─ returnerer ExtractedImage[]
       → persistImagesFromExtraction()        ← F226's størrelses-filter bor her
           └─ læser bytes, indsætter rækker
       → vision-rerun-job (F165, asynkront)   ← beskriver billederne
```

**Porten hører hjemme i `persistImagesFromExtraction`**, og det er tre grunde
der peger samme vej:

1. Det er **det ene sted alle formater går igennem**. Lagde vi den i
   PDF-udtrækkeren, skulle den gentages i docx, pptx og image — og en kopi
   nummer fire er præcis den fejlform F219 brugte en hel dag på at rydde op i.
2. **Bytesene er allerede læst dér** (`storage.get` står i funktionen), så
   entropi-målingen koster ingen ekstra diskadgang.
3. Den ligger **før** vision-jobbet sættes i kø. Et frafiltreret billede får
   ingen række, og jobbet henter sine kandidater fra rækkerne — så en klat kan
   ikke koste et vision-kald.

### Bytesene skal også væk — og det er en rettelse af F226

F226 springer **rækken** over, men billedets bytes er allerede skrevet til
disken af udtrækkeren og bliver liggende. Et billede vi har besluttet ikke at
beholde, som stadig fylder på disken, er ikke frasorteret — det er skjult.

**Begge frasorterings-veje sletter derfor bytesene.** Det er én kendsgerning
(«vi beholder ikke dette»), ikke to.

### Tærsklen, og hvorfor den er en indstilling

`minImageEntropy` ved siden af F226's `minImagePx` på Trail-indstillingerne.
Standard **0,5** — målingen ovenfor viser et tydeligt spring dér, og alt under
er ensfarvet.

**Nul betyder slukket**, præcis som `minImagePx`. Og en manglende måling
frasorterer ALDRIG: kan `sharp` ikke læse billedet, beholder vi det. «Vi ved det
ikke» og «der er intet i det» må ikke se ens ud — det er den samme regel som
det manglende sidetal i F227 og de manglende dimensioner i F226.

## Afhængigheder

- `sharp` — **allerede en afhængighed** af `apps/server` (0.34.5). Intet nyt.
- `@broberg/ai-sdk` ≥ 0.38 for `ai.ocr()`. Verificeret: den findes, og den
  peger som standard på `mistral-ocr-latest` over http.

**Ét hul fundet undervejs, og det hører til hos ai-sdk, ikke her:**
`getModelPrice('mistral-ocr-latest')` giver `undefined`, så OCR-kald får ingen
pris. Det rapporteres til ai-sdk-sessionen — vi skriver ikke tallet ind hos os,
for det er hele pointen med F228.

## Udrulning

Migration for den nye kolonne (additiv), derefter `pnpm ship:engine` og
`pnpm ship:admin`. Porten er slukket indtil tærsklen sættes — ship dark.

Oprydningen (F229.3) rører ikke noget af sig selv: den viser et tal og venter.

## RETTELSE — 0,5 var forkert, og målingen fangede det

Jeg anbefalede 0,5 og satte den på Sannes Trail. Så målte jeg hvad en side med
**ren tekst** scorer: **0,29**. Under grænsen. Den ville være blevet smidt ud.

Slået fra igen med det samme, og fordelingen målt ordentligt:

```
entropi-interval        antal   beskrevet
0     – 0,0001            296          0     ← PRÆCIS ensfarvet
0,0001 – 0,01               0          0     ← båndet er TOMT
0,01  – 0,05                4          0
0,05  – 0,1                 1          0
0,1   – 0,3                10          0
0,3   – 0,5                15          3     ← 0,5 ville koste 3 ægte billeder
over 0,5                  984
```

**Den rigtige grænse er 0,01, ikke 0,5.** Den fanger 296 af de 326 — og det
tomme bånd under den er hele argumentet: der er ingenting at ramme ved et uheld.
Det mindst indholdsrige læsbare vi kunne konstruere (et 300×300 hvidt felt med
ordet «ok») måler **0,0222**, altså over.

## OG OCR OPFINDER TEKST PÅ ET TOMT BILLEDE

Målt, ikke antaget. Mistral OCR fik et almindeligt 300×300-felt i **én farve**
og svarede med en LaTeX-formel:

```
\[ \operatorname{E}\left[\left\|\mathbf{x}-\mathbf{y}\right\|^2\right] … \]
```

Opfundet fra ende til anden. Ingen fejl, intet signal om at det var opfundet.

**Det er det dyreste denne kode kunne komme til at sende:** en opdigtet sætning
skrevet ind i en kundes vidensbase som tekst der var *læst fra hendes egen
kilde*. Sannes Trail har 296 ensfarvede billeder — uden en spærre ville
funktionen have lagt 296 hallucinationer ind i hendes søgbare tekst.

Derfor har `ocrImage()` et **fabrikations-gulv** der ikke er den samme knap som
indstillingen ovenfor: indstillingen er en præference, gulvet er en
korrekthedsspærre, og den gælder **også når kuratoren har slået porten fra**.

## Reuse

> **Kørt 4. september, efter at `/feature`-skillen igen kunne indlæses.** Dette
> tjek har aldrig kørt i dette repo før: den udgave af skillen der faktisk blev
> indlæst var fra 14. maj og indeholdt slet ikke Step 3.5. Se F234.

| kapacitet | Discovery-søgning | resultat |
|---|---|---|
| billed-entropi / ensfarvet-detektion | `?q=image entropy` | **intet match** — bygget lokalt med `sharp`, som allerede er en afhængighed |
| OCR | `?q=OCR` | **intet match** — går gennem `@broberg/ai-sdk`s `ai.ocr()`, altså flådens gateway, ikke en rå udbyder |
| billed-vision | `?q=vision` | **intet match** — går gennem `@broberg/ai-sdk`s `ai.vision()` |

**Positiv kontrol kørt:** `?q=mail` svarer `@broberg/mail` 200. Uden den ville
tre tomme svar ikke kunne skelnes fra et dødt endpoint — og det er præcis den
skelnen der er gået galt fire gange i dette repo på ét døgn.

**Ingen rå udbyder-integration.** Hverken Mistral OCR eller vision kaldes
direkte; begge går gennem `@broberg/ai-sdk`, så omkostning, fallback og
region-rapportering virker som alle andre steder.

