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
på begge kort efter flytningen). Et F-nummer på boardet uden en plan bag er
forbudt her, så den er skrevet i samme tur som fundet.

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
