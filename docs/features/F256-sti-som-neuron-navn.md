# F256 — Ti Neuroner blev født med en sti som navn

> **Ejeren, 6. september 2026:** *«Jeg undrer mig over at der ikke er en neuron i
> broberg.ai trail der hedder Christian Broberg — det tyder på at der er en del
> link fejl pga af dette.»*
>
> Han havde ret på begge punkter, og på en måde der er værre end «den mangler»:
> **den findes, og den er usynlig.**

## Fundet

```
filnavn:  /neurons/entities/neurons-entities-christian-broberg-md.md
titel:    /neurons/entities/christian-broberg.md          ← en STI, ikke et navn
indhold:  title: Christian Broberg  +  # Christian Broberg  ← helt korrekt
```

**Indholdet er upåklageligt.** Frontmatter bærer det rigtige navn, overskriften
og. Det er de to DATABASE-kolonner der er forkerte — og det er dem link-opløseren
slår op i.

## Skaden, målt

**328 brudte links i broberg.ai-basen.** De fire største mål:

| brudte | mål | forklaring |
|---:|---|---|
| 63 | `Christian Broberg` | denne fejl |
| 49 | `digital-transformation` | ikke denne fejl — undersøges separat |
| 40 | `flagskib` | denne fejl |
| 10 | `broberg-ai` | denne fejl |

**113 af de 328 forklares af ti fejlfødte Neuroner.** De ti:

```
/neurons/entities/christian-broberg.md      /neurons/entities/broberg-ai.md
/neurons/concepts/design-principper.md      /neurons/concepts/tags.md
/neurons/concepts/flagskib.md               /neurons/concepts/metodiske-tilgange.md
/neurons/concepts/ai-integration.md         /neurons/concepts/hjemmeside-udvikling.md
/neurons/concepts/kompilér-arkitektur.md    /neurons/concepts/arkitektoniske-mønstre.md
```

## Årsagen, i én linje

```ts
// packages/core/src/queue/candidates.ts:807
const rawName = payload.filename ?? op.filename ?? slugify(candidate.title) ?? 'untitled';
```

Et kompilerings-gennemløb sendte den fulde STI som `title`. `slugify` gjorde
pligtskyldigt hele stien til ét filnavn:

```
"/neurons/entities/christian-broberg.md"  →  "neurons-entities-christian-broberg-md"
```

Kompilerings-prompten advarer ordret mod netop dette (*«Title-field in frontmatter
MUST match the display form of the link-text»*), men **skrivevejen tog imod det i
stilhed.** En regel der kun står i en prompt, håndhæves af en model der er uenig
med sig selv fra gang til gang.

## Hvorfor det ikke blev opdaget

Den fejlfødte Neuron ser **helt normal ud** overalt hvor et menneske kigger:
den står på listen, den kan åbnes, indholdet er rigtigt, overskriften er rigtig.
Det eneste sted skaden er synlig er i link-opløsningen — og et brudt `[[link]]`
renderes bare som tekst. **Der er ingen rød markering nogen steder.**

Samme form som resten af døgnet: skaden er usynlig i det instrument man tilfældigvis
kigger i.

## Rettelsen — to dele, og den anden er den vigtige

**F256.1 — luk revnen ved skrivningen.** Når `title` ligner en sti, tages det
rigtige navn fra indholdets frontmatter. Det er ikke et gæt: `title:` står der
allerede og er korrekt i alle ti tilfælde. Findes der ingen frontmatter-titel,
bruges stiens sidste led — aldrig hele stien.

**F256.2 — reparer de ti.** Filnavn og titel udledes af indholdets frontmatter,
ikke af mit skøn. `[[Christian Broberg]]` opløses derefter på slug-reglen
(`christian-broberg` → `christian-broberg.md`).

Rækkefølgen er ikke vilkårlig: repareres før revnen er lukket, kan næste
kompilering skrive fejlen ind igen, og oprydningen er brugt på ingenting. Samme
lære som F252.

## Ikke-mål

- **Ingen gen-kompilering.** Indholdet er rigtigt; kun to kolonner er forkerte.
- **Ingen ændring af link-opløseren.** Den gør det rigtige — den bliver født
  forkerte data. At lære den at matche på en sti ville skjule fejlen i stedet
  for at fjerne den, og gøre enhver fremtidig fejlfødsel usynlig.
- **De 49 `digital-transformation`-links hører ikke til her.** Det mål findes
  ikke som Neuron overhovedet — en anden sag, og den skal måles for sig frem
  for at blive skyllet med i denne rettelse.
