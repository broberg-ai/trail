# F269 — En Neuron skal kunne pege på den kilde den kom fra

**Status:** in progress · **Rejst af:** måling under F268-oprydningen, 10/9 2026

## Hvorfor

Christian bad om at få 71 engelske dubletsider ud af broberg.ai — den Trail hans
hjemmesides chat svarer fra. Råkilderne var lette at finde og er arkiveret.

**Men fortyndingen sidder i NEURONERNE, ikke i råkilderne.** Og der kunne kun
**38 af de 71** parres med en Neuron. De 33 øvrige — blandt dem `en-helpdesk`,
`en-trail`, `en-cardmem`, `en-buddy` — har efterladt tekst i hjernen som vi ikke
kan pege på. Titel-match er alt vi har, og det er ikke godt nok til at arkivere på.

Det gælder ikke kun denne oprydning. Hver gang nogen ændrer mening om hvad der
hører til i en Trail, står vi samme sted.

## Målt — hvor kæden brækker

Jeg skrev først til Christian at der «ingen sporbarhed er». **Det var forkert, og
rettelsen er selve pointen med kortet:** halvdelen findes.

```
Neuron  ──►  kandidat        FINDES
             GET /api/v1/documents/<id>/provenance
             → { candidateId: "cnd_0f732811-024", connector, confidence, actor }
             (wiki_events.sourceCandidateId, skrevet ved hver oprettelse)

kandidat ──►  råkilde        MANGLER
             cnd_0f732811-024.metadata =
             {"op":"create","filename":"…","path":"/neurons/sources/",
              "tags":"…","connector":"mcp:claude-code","ingestJobId":null}
                                                        ^^^^^^^^^^^^^^^^^^
             Intet dokument-id. Intet job-id. Feltet FINDES og er null.
```

At `ingestJobId` står i formen og er tom er den nøjagtige adresse på fejlen: et
felt der er erklæret og aldrig udfyldt ligner dækning uden at være det — samme
fejlform som resten af ugen.

**Og `metadata` på selve dokumentet er `null` for alle 232 Neuroner i broberg.ai.**
Der er altså heller ingen genvej dér.

## Scope

**I scope**

- Kompilerings-pipelinen stæmpler kildens dokument-id på den kandidat den udsender.
- Provenance-endepunktet svarer med kilden, ikke kun med kandidaten.
- Den modsatte vej: «hvilke Neuroner kom fra DENNE råkilde» — det er den vej en
  oprydning faktisk spørger.
- Et felt der ikke kan udfyldes skal være FRAVÆRENDE, ikke null. «Vi ved det ikke»
  og «der er ingen kilde» må ikke se ens ud.

**Non-goals**

- Bagudrettet genskabelse for de 33. Den kan ikke gøres pålideligt, og et gæt der
  ser ud som sporbarhed er værre end et åbent hul. De får deres egen historie med
  en ÆRLIG usikkerhedsmarkering, eller de bliver liggende.
- Ændring af, hvad der auto-godkendes.
- Sletning af noget som helst.

## Afhængigheder

Ingen nye. Rører `packages/core/src/queue/candidates.ts`,
`apps/server/src/routes/documents.ts` og kompilerings-vejen i `packages/core`.

## Reuse

Discovery-tjek kørt for «provenance», «lineage», «document trace»: intet
`@broberg/*`-modul dækker det. Sporbarhed mellem Trails egne tabeller er
per definition Trail-specifik. Ingen rå leverandør-integration.

## Rollout

1. Stæmpling fremad + prøve der er rød uden den.
2. Begge opslagsveje eksponeret.
3. Først DEREFTER kan de 33 tages op igen — og kun med Christians ord.

## Den måling der lukker kortet

En NY råkilde kompileres, og opslaget «hvilke Neuroner kom fra denne kilde»
svarer med dem — uden titel-gutning, på id.
