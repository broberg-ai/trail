# F241 — billedlisten henter det fulde billede i hver miniature-ramme

**Kort:** trail-F241 · epic · critical
**Rapporteret af ejeren** 4. september 2026, med to skærmbilleder: Sources-listen der havde kørt i minutter, og billedlisten med tomme rammer — *«INGEN BILLEDER MERE SOM I SLET IKKE»*.

## Først: der er ikke slettet noget

Ejerens første frygt var at Sannes billeder var væk. **De er der alle sammen**, målt på produktionsvolumenet 4. september:

```
billed-rækker            1.385
filer fundet på disk     1.385   (0 mangler, 0 med dødt link)
uploads i alt            2.427 filer · 2,08 GB
dokumenter                 338   (326 klar, 12 arkiveret)
et billede hentet direkte  200 · 2 MB PNG · 0,57 s
```

Tallet 1.385 er præcis hvad der skulle stå tilbage efter ejerens egen
slette-ordre samme dag (1.557 − 172). Der er intet at gendanne.

## Hvad der faktisk sker

**0 af 1.385 billeder har en miniature.** `vision_derivative_path` er tom for
hver eneste række. Søge-endepunktet svarer derfor `thumbnailUrl: null`, og
klienten falder — korrekt, efter sin egen kontrakt `thumbnailUrl ?? url` —
tilbage på **det fulde billede**.

```
alle billeder        1.385 stk · 1.726 MB · gennemsnit 1,3 MB · største 29,5 MB
én skærmfuld (36)                  24,4 MB
  under 50 kB          673 stk ·     4 MB
  50-500 kB            351 stk ·    80 MB
  0,5-2 MB             209 stk ·   195 MB
  over 2 MB            152 stk · 1.447 MB
```

## Hvorfor det også brækker en helt anden side

Det her er den del der ikke er oplagt, og som gjorde fejlen svær at genkende.

En browser holder cirka **seks samtidige forbindelser til samme server**. De 36
billed-hentninger optager dem alle sammen i minutvis. Forespørgslen efter
Sources-listen bliver stillet i kø bag dem — og står der.

Så en liste på 86 rækker, som serveren selv leverer på **0,25 sekunder** (målt
direkte mod endepunktet, 50 kB JSON), tager **minutter i fanen**. Ejeren stillede
præcis det rigtige spørgsmål: *«det må da ikke tage 4 minutter at hente en liste
over ca. 86 gamle kilder»*. Nej — og det gjorde det heller ikke. Den ventede på
billederne.

**To sider, én årsag.** Det er derfor de begge «gik i stykker samtidig» uden at
noget var ændret i nogen af dem.

## Root cause: miniature-grænsen er MODELLENS, ikke skærmens

`needsDerivative(width, height, sizeBytes)` i `vision-derivative.ts` blev skrevet
til ét formål (F165.1): vision-modellen afviser billeder over 5 MB, så lav en
mindre kopi når originalen er **over 3 MB eller over 4 megapixel**.

Billed-søgningen genbruger den funktion til et helt andet spørgsmål — *skal denne
række tilbyde en miniature til en browser?* — og de to spørgsmål har ikke samme
svar. **Et billede på 500 kB er ubesværligt for en model og ødelæggende i et
gitter med 36 af dem.** 1.233 af 1.385 billeder ligger under modellens grænse og
får derfor aldrig en miniature.

Genbrugen var ikke sjusk — kommentaren i koden forklarer den udtrykkeligt og
kalder den «single source of truth for the derivative threshold». Det er bare
én sandhed for to forskellige spørgsmål.

## Rettelsen

En **visnings-miniature**, adskilt fra vision-derivatet, fordi de to har hvert
sit formål og hver sin størrelse:

| | vision-derivat (uforandret) | visnings-miniature (ny) |
|---|---|---|
| formål | de bytes modellen så | det øjet ser i en liste |
| når den laves | over 3 MB / 4 MP | **altid** |
| størrelse | lang kant 1568 px | lang kant 480 px |
| gemt som | `vision_derivative_path` | eget filnavn, rører ikke kolonnen |

`?variant=thumb` leverer fra nu af visnings-miniaturen for ALLE billeder, og
billed-søgningen sætter altid en `thumbnailUrl`. Originalen røres ikke —
tabsfri opbevaring er ufravigelig.

**Non-goal:** vision-derivatet og dets grænse laves ikke om. Det er korrekt til
sit eget formål, og at ændre det ville ændre hvad modellen ser.

## Reuse

Discovery-tjek 4. september mod `discovery.broberg.ai/api/search`:
`@broberg/media` er «the fleet's provider-agnostic media-storage facade» — den
løser HVOR filer ligger, ikke hvordan et billede skaleres til visning. Der er
ingen billedskalerings-primitiv i flåden. Trail har allerede `sharp` som direkte
afhængighed og bruger den i `vision-derivative.ts`; rettelsen tilføjer ingen ny
afhængighed. (Selve lagerskiftet er F222.1's ærinde, ikke dette korts.)

## Hvad der IKKE var galt — skrevet ned så det ikke undersøges igen

- **Adgangen.** `cb@webhouse.dk` står som `owner` i alle tre tenants i
  `control.db`. De 404'er jeg så undervejs kom fra min egen Lens-testbruger, som
  er bundet til `fd-aalborg` — ikke fra ejerens session. Det var en blindgyde,
  og den er noteret her så den ikke gentages.
- **Motoren.** Version 130, health 200 på 0,44 s, alle endepunkter under 0,5 s.
- **Dataen.** Se øverst: intet mangler.
