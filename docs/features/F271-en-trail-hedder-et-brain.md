# F271 — En Trail hedder nu et Brain

**Status:** in progress · **Besluttet af:** Christian, 11/9 2026 — «GO Brain»

## Hvorfor

Ordet **Trail** betyder to ting i samme skærmbillede:

```
produktet    «Sign in to Trail» · «Trail will compile it» · «the Trail API»
enheden      «Trails» · «Create Trail» · «in this Trail»
```

Beviset står i vores egen tekst. Den tomme tilstand er nødt til at DEFINERE ordet:

> «En trail er én vidensbase inde i denne tenant.»

Den sætning findes kun fordi navnet ikke forklarer sig selv. Et godt enhedsnavn
sletter den.

Det er samme fejlklasse som F270.2 dagen før, hvor lyd-kontakten hed «Ambient» —
samme ord som macOS-agenten der optager arbejdssessioner. Den her er større.

## Hvorfor Brain

Ikke et nyt ord — det ord produktet allerede bruger om sig selv, to steder som
ingen har besluttet:

| | |
|---|---|
| manifestet | *«Trail — din second brain»* |
| API'et | `/brain-versions` — en Trails tilstand hedder allerede en *brain version* |

Og det parrer med atomet: et **Brain** rummer **Neuroner**.

```
Trail          produktet
  Tenant       en isoleret kunde/kontekst
    Brain      en samling viden          ← hed «Trail»
      Neuron   den enkelte indsigt
```

**Fravalgt:** *Collections* (kolliderer med cms' egne collections — samme fejl,
nyt sted) · *Library* (naturligt på begge sprog, men siger opbevaring frem for
tænkning) · *Knowledgebase* (for almindeligt, og hører hjemme i API'et hvor det
allerede står).

## Det farlige, og hvorfor det ikke er en søg-og-erstat

Målt før noget blev ændret:

```
strenge med «trail» ...... 71 på engelsk, 71 på dansk
samme nøgler i begge ..... 71 af 71   ← beslutningen tages 71 gange, ikke 142
  ENHED   (omdøbes) ...... 44
  PRODUKT (urørt) ........ 26
  BEGGE   (håndskrives) ... 1
```

De 26 skal overleve: *«Sign in to Trail»*, *«the Trail API»*, `trail.db`,
`TRAIL_BACKUP_R2_*`, *«Connect Trail Ambient»*.

Og én streng bærer BEGGE betydninger i samme sætning:

> *«A **Trail Ambient** device is asking to save captures into your **Trail**»*

Den kan ingen regel klare. Den skrives om i hånden.

## Klassificeringen er DATA, ikke et mønster

De 71 nøgler ligger som tre eksplicitte lister. Et mønster ville skulle gentage
vurderingen hver gang det kørte; en liste er vurderet én gang og kan læses af et
menneske. Fuldstændigheden er målt: 44+26+1 = 71, nul uklassificerede, nul
dubletter, nul spøgelser.

## Vagten går BEGGE VEJE

- enheds-nøglerne må **ikke** indeholde «trail»
- produkt-nøglerne **skal stadig** gøre det

Den anden halvdel er den bærende. Uden den består «omdøb alt» prøven — og så
ville «Sign in to Brain» være grønt.

## Faser

| | flade | omfang |
|---|---|---|
| F271.1 | admin-appen | 71 nøgler × 2 sprog |
| F271.2 | docs.trailmem.com | 288 omtaler i ~20 markdown-filer |
| F271.3 | trailmem.com | via webhouse.app/admin — ALDRIG lokalt (HARD RULE) |

F271.3 er ikke vores at redigere direkte: `trail-landing`s indhold skrives via
prod-CMS'et på webhouse.app, og en lokal ændring når aldrig det levende site.

## Hvad der IKKE ændres

API'et (`/api/v1/knowledge-bases/`), URL'erne (`/kb/<id>`), databasen, slugs.
Ingen migrering, ingen brudte links. Det er **kun ord**.

## Åbent spørgsmål

**Dansk.** «Brain» beholdes uoversat i første omgang — «et Brain», «dine Brains».
Alternativet er «Hjerne». Det er Christians valg, og fordi navnet nu ligger som
data ét sted, koster et skifte én linje.

## Reuse

Discovery-tjek: intet `@broberg/*`-modul ejer produktvokabular. App-lokalt.
