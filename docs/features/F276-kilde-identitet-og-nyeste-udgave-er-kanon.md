# F276 — En kilde har en IDENTITET, og dens nyeste udgave er kanon

**Status:** Backlog. Afventer Christians GO. Ingen kode før da.
**Ejer-ordre, 16. september 2026 (ordret):**

> «Jeg tror at vi skal have en identifikation af en kilde og hvis kilden den ændrer sig
> så er det jo den nye kanon og fakta, og når det sker så skal du acceptere de
> modsigelser der opstår i køen — så når jeg retter et dokument i CMS gør det ikke at
> der kommer en ny modsigelse i køen hver gang. For når det handler om indhold på en
> hjemmeside der løbende kan rettes til, og det kommer til at ske rigtig mange gange på
> broberg.ai fordi der er meget af det der er skrevet der er noget værre lort, så nytter
> det jo ikke noget at du kompilerer og laver modsigelser — fordi det er en nyere udgave
> af den samme kilde. Hvis kilden, altså en URL på en hjemmeside, forbliver den samme,
> ja så skal den seneste udgave være kanon.»

Og umiddelbart efter:

> «Det må være en feature vi skal bygge i Trail, og så kan du lave en indstilling som
> hedder om en ny udgave af den samme kilde automatisk skal blive kanon.»

---

## 1. Motivation — den målte hændelse der udløste det

Natten mellem 15. og 16. september 2026 blev `broberg.ai/flagskibe/bid` redigeret mens
to sessioner kompilerede den. Målt:

```
version 5 → 14 på otte minutter, ca. én ny version hvert 45. sekund
status-påstanden skiftede TRE gange:  besluttet → bygges nu → lanceret
fem Neuroner påstod samtidig noget kilden ikke længere sagde
```

Det er ikke en kantsag. Kilden er ikke en fil nogen lægger op — den er en **hjemmeside**,
hentet automatisk af konnektoren `broberg-ai-site-sync`. Hver gang nogen retter siden i
CMS'et, ankommer en ny version i Trail uden at nogen gør noget. Ejerens egne ord om
hvorfor det vil ske ofte: *«der er meget af det der er skrevet der er noget værre lort.»*

Med dagens adfærd producerer hver eneste sådan rettelse **modsigelses-kandidater** i
køen, fordi modsigelses-detektoren sammenligner ny tekst mod gammel tekst. Den kan ikke
se at de to sider er den samme kilde på to tidspunkter. Det er ikke en uenighed der skal
afgøres af et menneske — det er en **afløsning**, og den skal ske af sig selv.

### Præcedensen, og hvorfor den ikke er nok

F200 (`docs/features/F200-tame-contradiction-lint-flood.md`) løste det samme symptom med
en tænd/sluk-kontakt pr. Brain: `knowledge_bases.contradictionLintEnabled`. Det virker,
og det er for groft. At slukke modsigelses-detektionen på hele CB-M1 for at undgå støj
fra site-synken ville også slukke den for de modsigelser der **er** værd at se — to
forskellige kilder der er uenige, eller en kilde der modsiger noget et menneske selv har
skrevet ind. Denne feature er den præcise udgave: skeln, frem for at slukke.

---

## 2. Målingen der bestemmer scope — kæden er brudt

Målt på produktionen 16. september 2026, på de faktiske rækker:

```
KILDEN     1e94ca9c-…   metadata: {"connector":"broberg-ai-site-sync",
                                    "sourceUrl":"https://broberg.ai/flagskibe/bid"}
NEURONEN   doc_ba74c740-115   metadata: None      ingestJobId: None
```

**Kilden kender sin identitet. Neuronen kender ikke sin kilde.**

Det eneste spor i dag er linjen `sources: ["flagskibe_bid.md"]` i Neuronens frontmatter:
et **filnavn i prosa**, ikke et felt. To problemer, og de er begge diskvalificerende:

1. **Et filnavn er ikke en identitet.** To forskellige sites kan begge levere `index.md`.
   Identiteten er URL'en, ikke filnavnet den blev gemt under.
2. **Det står i brødteksten.** Ingenting kan håndhæve det, ingenting opdaterer det, og en
   understreng-søgning efter det kan ikke skelne en påstand fra et citat — hvilket blev
   målt tre gange samme nat, i tre forskellige kontroller, af to forskellige sessioner.

Derfor er dette **ikke én historie**. Afløsnings-reglen kan ikke bygges før proveniensen
findes som et felt. Bygger man den ovenpå prosa-linjen, bliver resultatet en regel der
gætter — og en regel der gætter forkert vil **tie om en ægte modsigelse**, hvilket er
langt dyrere end den støj den skulle fjerne.

### Den bærende sætning, fra trail-ingest samme nat

> **Det der kan håndhæves mekanisk er proveniens, ikke overensstemmelse.**

Hele denne feature er den sætning omsat til kode. Vi kan ikke mekanisk afgøre om en
Neurons prosa er tro mod sin kilde. Vi kan mekanisk afgøre **hvilken kilde og hvilken
version den blev skrevet fra** — det er et felt, det kan tjekkes, og det fejler ærligt.

---

## 3. Scope

### F276.1 — Proveniens som FELT (forudsætning, ingen adfærdsændring)

Hver Neuron skrevet af en kompilering bærer fra nu af, i et felt og ikke i prosa:

| felt | hvad | hvorfor lige det |
|---|---|---|
| `sourceIdentity` | kildens **identitet** — URL'en når den findes, ellers `kb:<id>/<filnavn>` | det er den der er stabil hen over versioner |
| `sourceVersion` | kildens `version` på kompileringstidspunktet | svarer på «hvad dækker denne Neuron» |
| `sourceContentHash` | kildens `contentHash` | det eneste felt der beviser at INDHOLDET er det samme |

**Hvorfor hash og ikke `updatedAt`:** målt samme nat flyttede `updatedAt` sig på kilden
mens `version`, filstørrelse og hash stod stille — altså en skrivning uden en
indholdsændring. «Nogen skrev» og «indholdet er nyt» er to forskellige spørgsmål, og en
kontrol der kun læser det ene tager fejl i begge retninger.

Ship-dark: feltet skrives, intet læser det endnu. Ingen adfærd ændrer sig.

### F276.2 — Afløsning i stedet for modsigelse

Modsigelses-detektoren får proveniensen med ind (den har den ikke i dag —
`ContradictionCandidate` er `{documentId, filename, title, content, version}`). Derefter:

```
samme sourceIdentity,  nyere sourceVersion   →  AFLØSNING. Ingen kandidat i køen.
forskellig sourceIdentity                    →  MODSIGELSE. Uændret, den skal ses.
ingen sourceIdentity på den ene side         →  MODSIGELSE. Se afsnit 5.
```

Sparer også penge: detektoren laver **ét LLM-kald pr. par**. I dag betaler hver
site-rettelse for et kald der besvarer et spørgsmål vi allerede kender svaret på.

### F276.3 — Indstillingen (ejerens eksplicitte ønske)

`knowledge_bases.newerSourceVersionIsCanon`, ved siden af `contradictionLintEnabled`.
Additiv kolonne. Overflade i Brain-indstillinger, formuleret i produktsprog:

> **En ny udgave af den samme kilde bliver automatisk kanon**
> Når en hjemmeside eller et dokument rettes, er den nye tekst sandheden. Trail
> opdaterer de Neuroner der stammer fra den, uden at spørge. Slås den fra, lander
> hver ændring som en modsigelse du selv afgør.

**Standard: TIL.** Ejeren beskriver det som den ønskede normaltilstand, og en
indstilling der er slukket på dag ét er en funktion der ikke findes.

### F276.4 — Afløsning skal FORPLANTE sig (den halvdel der faktisk bed)

Det var ikke kilde-Neuronen der stod forkert i nat. Det var de **afledte**: `overview.md`,
`glossary.md`, `flagskib.md` — sider hvis egen identitet ikke er kildens URL, men som
bærer påstande kompileret fra den. Fem sider sagde «bygges nu» længe efter at siden sagde
«lanceret».

Afløser en ny kildeversion den gamle, skal **hver Neuron med den `sourceIdentity`**
markeres til genkompilering. Uden det flytter vi bare stilheden: køen bliver ren, og
hjernen svarer stadig forkert.

### Ikke-mål

- **Ingen automatisk «ingen forældede citater»-port.** Konkluderet af begge sessioner i
  nat og skrevet ind i F263.16: en kilde-side der DOKUMENTERER versionshistorik *skal*
  indeholde de gamle citater — det er hele dens job. Enhver understreng-port ville rødne
  netop den side der gør arbejdet rigtigt.
- **Ingen sletning af gammel viden.** Se afsnit 4.
- **Ingen ændring af hvad der gemmes i UTC.** Rækkefølge og sammenligning forbliver
  absolutte tidspunkter.

---

## 4. Den ene beslutning jeg har truffet uden at spørge

**Den gamle version slettes ikke — den mærkes som historik.**

Nattens arbejde er beviset for at historikken har værdi: notaterne «version 2 sagde
«bygges nu»» er præcis det der gjorde driften synlig i stedet for at skulle gættes, og
det der forhindrede den næste session i at genopdage hvorfor datoen var forkert.

Så: den nye version er kanon **som påstand**. Den gamle bevares som *det kilden sagde
før*, tydeligt mærket, aldrig som nutid. Ejeren har ikke bedt om sletning, og «kanon»
betyder hvad der gælder nu — ikke at fortiden aldrig fandtes.

---

## 5. Hvor det kan gå galt, sagt højt

**Den farlige fejlretning er tavshed.** En modsigelse der ikke bliver rejst, ser præcis ud
som en der ikke findes. Derfor:

- **En Neuron uden `sourceIdentity` behandles som modsigelse, ikke som afløsning.** Alle
  eksisterende Neuroner mangler feltet i dag. Faldt tvivlen ud til «afløsning», ville
  featuren gøre hele den nuværende base usynlig for modsigelses-detektion i det øjeblik
  den blev slået til.
- **En curator-redigeret Neuron er ikke længere ren kilde-viden.** Har et menneske skrevet
  i den, kan en ny sideversion ikke uden videre overskrive den. Skal spores og
  respekteres.
- **Afløsning skal kunne SES.** Ikke i modsigelses-køen, men som «kilden er opdateret,
  N Neuroner genkompileret». Et lydløst indgreb kan ikke skelnes fra at intet skete.

---

## 6. Reuse (F217 — Discovery-tjek)

Slået op mod `discovery.broberg.ai` for de kapabiliteter featuren rører:

- **Indholds-hash / ændringsdetektion** — ingen `@broberg/*`-pakke ejer dette. Trails egen
  `documents.contentHash` findes allerede og bruges; ingen ny primitiv, intet at genbruge.
- **Proveniens-sporing** — ingen delt pakke. F269 (`laesKildePeger`) definerede allerede
  formen `{sourceDocumentId, ingestJobId}` i dette repo; F276.1 udvider den frem for at
  opfinde en ny. **Genbrug internt, ikke nyt.**
- **LLM-kaldet** i detektoren går allerede gennem husets gateway. Uændret.
- **Ingen ny provider-integration**, ingen rå `fetch`, intet at migrere.

Konklusion: ingen ekstern genbrug tilgængelig; featuren udvider en eksisterende intern
form. Er mønsteret brugbart for andre repoer der synkroniserer hjemmesider ind i en KB,
meldes det til `components` når det har kørt.

---

## 7. Rollout

1. **F276.1** ship-dark — feltet skrives, intet læser det. Ingen adfærdsændring.
2. **F276.3** indstillingen, standard TIL, men uden effekt før F276.2 er inde.
3. **F276.2** afløsnings-reglen. Fra nu af holder køen op med at støje på site-rettelser.
4. **F276.4** forplantning + genkompilering af afledte Neuroner.

Trin 4 er det der gør featuren rigtig frem for bare stille. Leveres den ikke, er
resultatet en ren kø og en hjerne der stadig svarer på gårsdagens tekst — og det er en
værre tilstand end i dag, fordi den ikke længere ligner et problem.

---

## 8. Åbne spørgsmål til ejeren

1. **Hvad er identiteten for en kilde uden URL?** Et PDF lagt op igen under samme navn:
   ny udgave af samme kilde, eller en ny kilde? Forslag: samme identitet ved samme
   filnavn i samme Brain — men det er hans kald, og det er forkert at gætte.
2. **Hvor meget må en genkompilering koste?** Trin 4 kan røre mange Neuroner pr. rettelse.
   Der bør være et loft, og han skal sætte det.
