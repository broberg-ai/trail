# F275 — Samme kilde, ny udgave: den seneste er kanon

**Kort:** trail-F275 · epic · **høj**
**Status:** foreslået 16. september 2026 — ejerens beslutning, afventer GO før kode

---

## Ejerens ord

Christian, 16. september 2026, ordret:

> *«Jeg tror at vi skal have en identifikation af en kilde, og hvis kilden den ændrer
> sig, så er det jo den nye kanon og fakta. Og når det sker, så skal du acceptere de
> modsigelser der opstår i køen — så når jeg retter et dokument i CMS, gør det at der
> ikke kommer en ny modsigelse i køen hver gang. For når det handler om indhold på en
> hjemmeside der løbende kan rettes til — og det kommer til at ske rigtig mange gange
> på broberg.ai, fordi der er meget af det der er skrevet der er noget værre lort — så
> nytter det jo ikke noget at du kompilerer og laver modsigelser, fordi det er en nyere
> udgave af den samme kilde. Hvis kilden — altså en URL på en hjemmeside — forbliver
> den samme, ja så skal den seneste udgave være kanon.»*

Og umiddelbart efter:

> *«Det må være en feature vi skal bygge i Trail, og så kan du lave en indstilling som
> hedder om en ny udgave af den samme kilde automatisk skal blive kanon.»*

## Hvorfor det haster

Natten mellem 15. og 16. september blev én kilde — `broberg.ai/flagskibe/bid` —
redigeret **fra version 2 til version 14 på under en time**, hurtigst ca. én ny version
hvert 45. sekund. Hver gemning i CMS'et sender en ny udgave til Trail via konnektoren
`broberg-ai-site-sync`.

Det er ikke en kantsag. Det er den normale arbejdsform på et site hvor indholdet bliver
skrevet om løbende. Uden denne feature producerer hver eneste rettelse en modsigelse
kuratoren skal tage stilling til — og modsigelsen er falsk, for der er kun ÉN kilde og
den har skiftet mening om sig selv. Det er ejeren der har ret, ikke basen.

**Konsekvensen af at lade være:** kuratorkøen fyldes med støj i takt med at ejeren
retter dårlig tekst på sit eget site. Jo mere han forbedrer indholdet, jo mere arbejde
giver Trail ham. Det er et incitament der vender forkert.

## Målt, før noget bygges

```
Råkilder i broberg.ai:                    70
  med en sourceUrl i metadata:            66   (94 %)
  uden:                                    4
Konnektorer:  broberg-ai-site-sync  66  ·  (ingen)  4
```

**Identiteten findes altså allerede** — `metadata.sourceUrl` er stemplet på hver
site-sync-kilde. Den er bare ikke et felt noget i systemet regner med. Det er en
backfill, ikke en udgravning.

Modsigelses-linten (`packages/core/src/lint/contradictions.ts`, 232 linjer) springer
allerede over når to Neuroner har samme `documentId` (linje 66). Den kender ikke
begrebet *samme kilde* — kun *samme dokument*. To Neuroner kompileret fra samme URL på
hver sin dag har hver sit documentId og bliver sammenlignet som uafhængige påstande.
**Det er præcis hullet.**

## Beslutningen

1. **En kilde har en IDENTITET.** For en hjemmeside-kilde er det URL'en. Forbliver
   URL'en den samme, er det den samme kilde — uanset hvor meget teksten ændrer sig.
2. **Den seneste udgave af en identitet er KANON.** De tidligere udgaver er ikke
   konkurrerende fakta. De er afløst.
3. **En ny udgave rejser derfor ingen modsigelse mod sin egen forgænger.** Den erstatter
   den.
4. **Det er en INDSTILLING, ikke en antagelse.** Ejeren slår den til/fra pr. Brain.

## Afgrænsning

**I epic'en:**

- Kilde-identitet som førsteklasses felt + backfill af de 66.
- Indstillingen «En ny udgave af samme kilde bliver automatisk kanon» pr. Brain.
- Linten respekterer den: samme identitet ⇒ erstatning, aldrig modsigelse.
- Genkompilering ERSTATTER en kildes Neuron-indhold frem for at lægge lag på.

**Non-goals:**

- **At slukke modsigelses-linten mellem FORSKELLIGE kilder.** To sider der er uenige er
  stadig et ægte fund. Det er kun selv-modsigelsen over tid der er støj.
- **At slette de gamle udgaver.** Dokumenter er versionerede i forvejen; historikken
  bevares i databasen. Det der ændres er hvad der regnes for KANON — ikke hvad der
  gemmes.
- **At rydde op i eksisterende modsigelser i køen.** Ændringen er fremadrettet. En
  separat oprydning kan komme senere hvis køen viser sig fuld af netop denne type.
- **En automatisk «ingen forældede citater»-port.** Se F263.16's non-goal: den kan ikke
  bygges. Det der kan håndhæves mekanisk er proveniens (hvilken version en påstand
  dækker), ikke overensstemmelse.

## Arkitektur-skitse

```
  kilde-række          + sourceIdentity   (URL for site-sync; eksplicit for øvrige)
  knowledge_base       + newVersionIsCanon (bool, default TRUE)

  ingest/recompile  →  slår op på sourceIdentity, ikke på documentId
                    →  er der en tidligere udgave OG indstillingen er TIL:
                         markér den forrige som AFLØST, ikke som modpart

  contradictions.ts →  skip når sourceIdentity(a) === sourceIdentity(b)
                       (i dag: kun skip når documentId(a) === documentId(b))
```

Identiteten skal være EKSPLICIT, ikke udledt af filnavn eller titel. Et filnavn er ikke
stabilt, og to sider kan hedde det samme. URL'en er den eneste stabile nøgle vi har på
en hjemmeside-kilde — og den ligger der allerede.

## Afhængigheder

- **F263.16** (foreslået) — version + indholds-hash på «færdig». De to hænger sammen:
  F263.16 besvarer *hvilken udgave er kompileret*, F275 besvarer *hvad betyder det at
  der er kommet en ny*. F275 kan bygges uden, men bliver bedre med.
- Modsigelses-linten, `packages/core/src/lint/contradictions.ts`.
- Konnektoren `broberg-ai-site-sync`, som allerede stempler `sourceUrl`.

## Rollout

1. Identitet + backfill (ingen adfærdsændring — feltet fyldes bare).
2. Indstillingen, default TIL. Ejerens ord er at det er den ønskede adfærd; en
   indstilling der som standard gør det forkerte er en indstilling ingen finder.
3. Linten respekterer identiteten.
4. Genkompilering erstatter frem for at lægge lag på.

Hvert trin er additivt. Slås indstillingen fra, opfører systemet sig præcis som i dag.

## Åbne spørgsmål

- **Hvad er identiteten for en UPLOADET fil?** De fire kilder uden `sourceUrl` er
  uploads. Filnavn + Brain er nærliggende men skrøbeligt: to versioner af samme rapport
  hedder sjældent det samme. Forslag: uploads får en eksplicit identitet ejeren kan
  sætte, og uden en identitet opfører de sig som i dag (hver upload er sin egen kilde).
  Det bør ikke blokere hjemmeside-kilderne, som er dem det gør ondt på nu.
- **Skal indstillingen være pr. Brain eller pr. konnektor?** Pr. Brain er enklest og
  matcher ejerens formulering. Pr. konnektor ville tillade «site-sync er kanon,
  uploads er ikke» — men det er en finere skelnen end nogen har bedt om endnu.
