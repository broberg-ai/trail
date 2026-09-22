# F287 — @broberg/ai-sdk har stået stille på 0.38 i 19 dage

**Fundet 22. september 2026**, og kun fordi et andet repo målte noget andet.

---

## 1. Hvad der skete

Jeg rapporterede en fejl i `contracts.classify()` til `ai-sdk`-sessionen: et
svar uden for etiket-listen blev returneret som `labels[0]`, umuligt at skelne
fra et ægte svar. Fundet var rigtigt — i den kode jeg havde foran mig.

Den var rettet **9. september** (v0.42.0, deres F052) og igen **15. september**
(v0.47.1, F052.2, hvor den modsatte fejl var opstået: matchningen blev for
streng og kasserede rigtige svar).

> **Versionsnummeret her blev rettet samme dag, og måden er værd at have.** Både
> `ai-sdk` og `components` sagde først **0.41.1**. Vi regnede baglæns fra npm's
> udgivelsestider og fandt at 0.41.1 udkom **4. september** — altså FIRE DAGE
> før den commit der bærer rettelsen. `ai-sdk` målte selv efter og bekræftede:
> rettelsen ligger i **0.42.0**.
>
> Årsagen er generel og rammer alle: **`package.json` på en commit er den version
> grenen kom FRA, ikke den den blev udgivet I.** Bumpet ligger typisk i en senere
> commit. Og det er uforudsigeligt i samme repo — F052.2 havde bumpet i SAMME
> commit, så dér passede tallene.
>
> Kontrollen der svarer rigtigt:
> `git tag --contains <commit> | sort -V | head -1`, krydstjekket mod
> `npm view <pkg> time`. Er udgivelsestiden FØR commit-tiden, er nummeret
> forkert læst.
>
> **Havde vi pinnet 0.41.1 som først oplyst, havde vi fået en version UDEN
> rettelsen — og et grønt svar på at vi var dækket.** Samme fejlform som hele
> dette kort handler om.

Vi så den stadig, fordi vi kører **0.38.0**.

## 2. Målingen

```
pin i repoet        "^0.38.0" i packages/shared, apps/server, apps/scout
installeret         node_modules/.pnpm/@broberg+ai-sdk@0.38.0
npm seneste         0.47.1
Discovery enrolled  0.38.0, registreret 8. september kl. 09.32 dansk tid

0.38.0 udgivet  3. september
0.47.1 udgivet 15. september
13 udgivelser imellem
```

## 3. Mekanismen — og hvorfor intet så forkert ud

**Under 1.0.0 betyder npm's caret PATCH-ONLY.** `^0.38.0` er `>=0.38.0 <0.39.0`.

Det er ikke en fejl i pnpm og ikke en fejl i pakken. Hvert `pnpm install` har
loyalt geninstalleret 0.38.0 i 19 dage, præcis som pinnet bad om. Der var intet
rødt at se, ingen advarsel, ingen fejlende port.

**En frossen pin ligner en aktuel.** Det er hele problemet: tilstanden er
usynlig indtil nogen sammenligner med noget uden for repoet.

**Set to gange på to dage i flåden.** `helpdesk` stod på `^0.1.0` af
`@broberg/sso` og troede de fulgte 0.2.x (components' måling, samme uge). Samme
læsefejl, andet repo, og begge gange opdaget først da nogen målte noget andet.

## 4. Hvad det allerede har kostet

- **En tur brugt på at rapportere en lukket fejl** til det hold der lukkede den.
  `components` brugte en tur på at videresende den, og måtte selv trække den
  tilbage.
- **En egen parser i `apps/scout/src/baseline.ts`** (F286.3) bygget for et skel
  pakken allerede leverer siden 0.42.0: `label: string | null` + `rawLabel`.
  Deres udgave er bedre end vores — den fanger også tvetydighed, hvor svaret
  prefixer to etiketter.

Det er den billige ende. **Den dyre er de 12 andre udgivelser vi ikke har
læst.** Vi ved ikke hvad de rettede. Der kan ligge fejl vi har levet med i tre
uger uden at vide at de var lukket, på nøjagtig samme måde.

## 5. Blast radius — derfor er det ikke en `pnpm up`

`ai`-facaden i `apps/server/src/lib/ai.ts` er **eneste vej til en provider i
motoren**. Husreglen er at ingen service må kalde en provider-SDK direkte, og
den er overholdt — hvilket er godt, og som betyder at ÉN breaking ændring rammer
alle forbrugere på én gang:

```
vision · chat-syntese · oversættelse · tag-forslag
source-infer · glossary-backfill · contradiction-lint
```

I produktion. Hos tre kunder. Derfor er kortlægningen skridt 1 og opgraderingen
skridt 2 — ikke omvendt.

## 6. Scope

**I scope:**

1. Læs hvad der ændrede sig fra 0.38.0 til 0.47.1. Kilde: CHANGELOG, commits,
   eller `ai-sdk`-sessionens eget svar — de har tilbudt at svare direkte, og de
   kender brudfladerne bedre end en changelog gør. **Tre er allerede navngivet af
   dem, ugennemgået mod vores `ai.ts`:**

   | fra | brudflade |
   |---|---|
   | 0.43+ | `override:{provider}` UDEN `model` KASTER nu. Før kørte den videre med tierens model og postede den til den forkerte udbyder — altså en rettelse, men en der kan vælte et kaldested der levede med fejlen |
   | 0.45+ | `arguments` på en tool-call er valgfri når man læser en `Message` tilbage → `msg.toolCalls[0].arguments.x` kræver en narrow under strict |
   | 0.47+ | `usage.region` findes og udledes af det endpoint der FAKTISK svarede |

   Den sidste er ikke breaking, men den er den vi har mest brug for: den svarer
   på hvor data endte, hvilket `resolveModel()` udtrykkeligt ikke gør.
2. Opgradér alle tre `package.json` samtidig.
3. Skriv pinnet så det ikke kan fryse igen.
4. Kør motorens LLM-veje mod den nye SDK og se dem svare.
5. Opdatér Discovery-enrollment.
6. Migrér `baseline.ts` tilbage til `contracts.classify()`, eller skriv i filen
   hvorfor den egne parser beholdes.

**Non-goals:**

- **Ikke en gennemgang af alle andre `@broberg/*`-pins.** Discovery's gap-liste
  viser at vi mangler flere pakker helt, og et par af de enrollede kan have
  samme frosne-pin-problem. Det er ægte og det er sit eget kort — dette kort
  betaler ikke hele den regning for at kunne lukke.
- **Ikke en ændring af `ai`-facadens egen form.** Den er rigtig; det er dens
  underliggende pakke der er gammel.
- **Ikke en udrulning.** Opgraderingen landes og bevises; udrulningen til
  motoren er Christians egne ord, fordi den rører den eneste vej til en LLM.

## 7. Åbent spørgsmål — hvordan skal pinnet skrives

To veje, og valget er reelt:

| | Eksakt version (`0.47.1`) | Interval der følger minors (`>=0.47.1 <1.0.0`) |
|---|---|---|
| Opgradering | bevidst, én commit pr. bump | automatisk ved næste install |
| Risiko | glemmes — præcis dette kort | en 0.x minor kan være breaking, og lander uset |
| Passer til | et lag hvor en overraskelse er dyr | et lag hvor at være bagud er dyrere |

**Min anbefaling er EKSAKT version plus en tilbagevendende kontrol** frem for et
bredere interval. Grunden er blast radius i afsnit 5: på en 0.x er en minor
lovligt breaking, og et interval ville lade netop dét ramme motorens eneste
LLM-vej uden at nogen valgte det. Problemet i dette kort er ikke at pinnet var
stramt — det er at **ingen kiggede**. Et bredere interval fikser ikke det; det
flytter bare fejlen fra «vi er bagud» til «vi blev opgraderet uden at vide det».

Kontrollen findes allerede og koster ingenting:
`GET https://discovery.broberg.ai/api/sessions/trail` viser `enrolled` ved siden
af `available`. Den skal bare læses af nogen, med en fast kadence.

**Det er ejerens valg, ikke vores.**

## 8. Reuse

Discovery-tjek 22. september 2026.

- **`@broberg/ai-sdk` ER genbrugs-svaret her** — kortet handler om at bruge den
  RIGTIGE udgave af den, ikke om at erstatte den. Husreglen om at alle LLM-kald
  går gennem SDK'et står uændret og er allerede overholdt.
- **`ai-sdk`-sessionen ejer pakken.** De har bedt om at blive kontaktet direkte
  frem for gennem `components`, og de har tilbudt at svare på breaking
  ændringer. Brug det frem for at læse 13 changelogs i blinde.
- **Discovery er instrumentet der kunne have fanget det.** `enrolled` vs.
  `available` er præcis dette spørgsmål, og det svarer uden en måling.
- **Ingen ny pakke skal bygges.** Der er intet her der hører til i
  `components` — det er vedligehold af en afhængighed vi allerede har.

## 9. Lektien, som er større end pakken

**En tilstand der kun kan ses udefra, bliver ikke set.** Pinnet var korrekt,
installationen var korrekt, porten var grøn, og vi var 13 udgivelser bagud. Der
var ingen fejl at opdage — kun en sammenligning ingen foretog.

Det er samme form som `components` katalogiserer på tværs af flåden: en
oplysning mister sin egen tilstand og ankommer i en form der ligner et svar.
Her er formen bare langsommere: et pin der ser aktuelt ud er et svar på
spørgsmålet «hvilken version bruger vi», og det er endda et RIGTIGT svar — det
besvarer bare ikke det spørgsmål nogen troede de stillede, som var «er vi
opdaterede».
