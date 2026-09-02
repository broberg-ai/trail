# F223 + F224 — landing-teksterne ind i CMS'et

**Kort:** trail-F223 · trail-F224 · begge story · high
**Fælles epic:** cms-F185 (`docs/features/F185-trail-aegte-cms-site.md` i cms-repoet)

> Christians mål: trail skal være et **ægte CMS-site** — alt indhold i CMS under
> org `broberg-ai`, inline-redigering på alt, 1:1 med `broberg.ai` og
> `sanneandersen.dk`.

## Hvorfor disse to kort ligger her og ikke hos cms

Planen blev skrevet af cms-sessionen på deres board, fordi Christian bad dem om
det. To af de fire stories rører **vores** kode — `apps/landing/build.ts` og
`apps/landing/public/uploads/svg/captions.json` — så de blev **flyttet** hertil,
ikke spejlet.

Flyttet, ikke kopieret, med vilje: en kortrække der findes to steder er to
rækker der kan skride fra hinanden. F219 brugte en hel dag på præcis den form —
syv kopier af den samme søgefunktion, hver enkelt rigtig den dag den blev
skrevet. Og et kort på cms' board ville aldrig blive samlet op af en
trail-session i queue-drain.

**Denne plan-doc findes fordi flytningen ikke tog plan-doc'en med** (`plan: null`
på begge kort efter flytningen; cms måler det samme som `plans_copied: 0`). Et
F-nummer på boardet uden en plan bag er forbudt her, så den er skrevet i samme
tur som fundet.

**Og numrene skiftede undervejs:** `move_card_to_project` tildeler
modtager-projektets næste frie F-nummer, så cms' `F185.1`/`F185.2` blev vores
`F223`/`F224`. Dokumenteret opførsel, ikke et uheld — men enhver henvisning til
de gamle numre er nu død, og det er derfor oversættelsen står skrevet her.

## F223 — de 30 billedtekster

**Målt:** `apps/landing/public/uploads/svg/captions.json` — 30 poster, 6.239
bytes, læst live af `build.ts:1223`. Ægte redaktionel prosa:

```
memex-desk         "A schematic reading of Bush's proposed desk: slanting
                    translucent screens, keyboard, levers, and microfilm reels…"
how-trail-works-en "Four steps, one Trail. A source becomes a candidate; the
                    curator decides; the Neuron enters the Trail…"
```

En redaktør kan hverken **søge dem frem** eller **rette dem**. De kan kun ændres
med et deploy — og deploys når ikke frem (se blokeringen nedenfor).

`captions.json` bliver stående som nødbremse. Den må bare ikke være det eneste
sted teksten findes.

## F224 — inline-redigering

**Målt** med cms' eget værktøj, `cms check-editable --sitemap`:

| | sider | redigerbare felter | huller |
|---|---|---|---|
| **trailmem.com** | 62 | **0** | 700 |
| broberg.ai *(kontrol)* | 103 | 9.930 | 0 |

**Kontrol-linjen er det der gør tallet brugbart.** Uden den kan «0 redigerbare
felter» ikke skelnes fra «værktøjet virker ikke» — og det er nøjagtig den
skelnen der er gået galt fire gange på ét døgn i dette repo.

Attributterne (`data-cms-field`) udsendes af **vores** `build.ts`.

### De 700 huller er ikke 700 beslutninger

cms krydstjekkede hvert huls tekst mod alt CMS-indhold på `site=trail`
(#25017), og opdelingen ændrer opgavens form:

| | | |
|---|---|---|
| **618** | teksten **står allerede i CMS'et** — mangler kun `data-cms-field` | **88,3 %** |
| **82** | teksten findes **ikke** i CMS'et (75 unikke) | 11,7 % |

*700 i alt, heraf 680 unikke — resten er samme tekst på flere sider.*

**De 618 er én ændring i `build.ts`**, ikke 618 beslutninger: teksten er
allerede redigerbar i admin, den kan bare ikke klikkes på ude på siden. **De 82
er det egentlige indholdsarbejde.**

> **Brug 618/82. Brug IKKE 344/33** fra cms' tidligere besked — de har selv
> markeret det som *superseded*. Det tal scannede hele siden inkl. menu og fod
> og talte unikke strenge frem for elementer, altså en anden population end
> `check-editable`. To tal fra to udsnit er præcis den slags par nogen lægger
> sammen.

Krydstjekket afdækkede desuden en kategori ingen af os havde: **tekst bagt ind i
selve SVG-figurerne** — «TRANSLUCENT SCREEN KEYBOARD LEVERS MICROFILM STORAGE»,
«1945 MEMEX Bush · 1968 THE DEMO Engelbart». Det er synlig prosa **og** en del af
en tegning. Den hører til som sin egen beslutning i cms-F185.3, ikke i bunken.

## Begge er blokeret af F216 — og det er ikke en formalitet

> **cms' kort nævner deres eget `F184`. I dette repo hedder blokeringen `F216`.**
> Noteret her, fordi en trail-session ellers ville lede efter et F-nummer der
> ikke findes hos os.

Vores udrulning af forsiden har fejlet **hver gang siden 19. august**:

```
Error: app not found        (5 kørsler, 5 fejl)
```

Workflowen kører `flyctl deploy` mod en Fly-app der ikke eksisterer. Ingen
opdagede det, fordi sitet blev ved med at være online — cms bygger det fra deres
egen kopi af vores byggefil, frosset **3. maj**.

Konsekvensen, målt på det levende site 2. september:

```
Sign In → app.trailmem.com     LIVE      ✓   (CMS-værdi)
broberg.ai som link i footer   IKKE live ✗   (kode)
"built by" → "built with"      IKKE live ✗   (kode)
```

**Indhold flyder, kode gør ikke.** Derfor kan ingen af disse to kort bygges
endnu: begge kræver en ændring i `build.ts`, og den ville bygge lokalt, passere
CI og aldrig nå en læser.

## Rækkefølgen, aftalt med cms (#25010 → #25011)

1. Vi retter vores workflow → beviser den er grøn
2. Vi beviser at en **kodeændring** faktisk når frem. Prøven er `"built with"` —
   allerede committet, og allerede beviseligt ikke fremme
3. **Først derefter** fjerner cms deres frosne kopi

**cms rører ikke deres kopi før punkt 2.** Lige nu er den det eneste der holder
trailmem.com i luften; fjernes den før vores rør virker, går sitet ned.

## Porten skal fejle LUKKET

cms' formulering, og den er den vigtigste sætning i tråden: *kan porten ikke nå
sitet, skal den melde **fejl** — ikke nul huller.*

Det er ordret vores egen fejl fem gange på to uger: udrulningen fejlede, sitet
blev ved med at være online, og tavsheden lignede sundhed. Derfor skal enhver
kontrol her have sin egen negative kontrol — peg den på et domæne der ikke
svarer, og den **skal** gå rød. Ellers kan ingen se forskel på en grøn port og
en blind.
