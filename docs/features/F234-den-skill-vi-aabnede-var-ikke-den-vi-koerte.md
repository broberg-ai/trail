# F234 — den skill vi åbnede var ikke den vi kørte

**Kort:** trail-F234 · story · high · **rettet i samme tur**

## Meldt af cardmem, verificeret her

To filer med samme formål lå side om side:

```
.claude/skills/feature/SKILL.md   9.562 bytes, 14. maj   ← den der BLEV INDLÆST
.claude/skills/feature.md        14.096 bytes, 11. juli  ← død, og flådens AKTUELLE
```

En flad `.md` i `.claude/skills/` registrerer som **ingenting**. Så siden maj
har `/feature` kørt en maj-udgave, mens den opdaterede lå ved siden af og aldrig
kunne kaldes.

## Konsekvensen cardmem ikke nævnte, og som er den dyre

**Det påbudte Discovery-genbrugstjek har aldrig kørt i dette repo.**

```
maj-udgaven (den kørende):   0 omtaler af Discovery / Reuse / Step 3.5
juli-udgaven (den døde):     7
```

Og `CLAUDE.md` linje 522 lovede det ordret — *«see `.claude/skills/feature.md`
Step 3.5»* — altså en henvisning til **den døde fil**, om et trin der aldrig har
været i den skill der faktisk kørte. Reglen stod skrevet, blev læst, og kunne
ikke virke.

**Det er husets fejlform igen, et lag længere ude:** dokumentationen beskrev
korrekt en mekanisme der ikke var koblet til. Ingen fejl, intet signal — bare et
trin der aldrig skete.

## Valget, og hvorfor (a)

cardmem stillede to muligheder. Valgt: **tag flådens aktuelle udgave.**

Grunden er målt frem: **mit eget tillæg var der allerede.** Commit 53540a4
tilføjede en `## Stories`-sektion til maj-udgaven i maj; juli-udgaven har den
(linje 118). Den var vandret ud i flådens skabelon. Så (a) koster ingenting og
henter tre måneders forbedringer hjem, inklusive netop det Step 3.5 vores egen
CLAUDE.md påberåber sig.

`git mv -f` frem for kopier-og-slet, så historikken følger med.

## Den anden fejl: `$0` bliver erstattet som et shell-argument

cardmem meldte den; den var i **vores egen** skill, og beviset står i denne
sessions egen udskrift. `/local-ingest sanne-andersen` renderede:

```
skrevet:    The **$0 ingest engine** for F191
renderet:   The **sanne-andersen ingest engine** for F191

skrevet:    NEVER shell out to claude -p (Anthropic API-bills it → not $0)
renderet:   … → not sanne-andersen
```

**Hele kontrakten om at drænet er gratis blev til et tenant-navn.** Ni steder.
En session der læste den ville ikke kunne se at pointen var prisen.

Rettet ved at skrive prisen uden et dollartegn efterfulgt af et ciffer — «free
on the Max plan» — så den ikke kan interpoleres af noget som helst. De tre
cardmem-ejede gate-skills har samme mønster; cardmem har rettet deres, og
rettelsen kommer med næste skabelon-synk.

## Bevist, ikke antaget

**Før rettelsen** stod `feature` ikke på listen over skills denne session kunne
kalde. **Efter `git mv`** dukkede den op. Det er beviset — ikke at filen ligger
det rigtige sted, men at værktøjet kan se den.

Samme for den anden: skill-beskrivelsen læser nu *«free on the Max plan»* hvor
den før læste et tenant-navn.

Og genbrugstjekket blev kørt med det samme — med **positiv kontrol**, fordi tre
tomme svar fra et dødt endpoint ser præcis ud som tre tomme svar fra et levende:

```
?q=image entropy   intet match
?q=OCR             intet match
?q=vision          intet match
?q=mail            @broberg/mail 200   ← kontrollen
```

## Non-goal

Vi retter ikke de tre cardmem-ejede skills her. De ejes af skabelonen, og en
lokal rettelse ville skride ved næste synk.
