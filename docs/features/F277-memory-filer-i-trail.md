# F277 — Agenternes memory-filer skal lande i Trail

**Status:** Backlog. **Blokeret af [F275](F275-samme-kilde-ny-udgave-er-kanon.md).**
**Ejerens ordre, 16. september 2026:** *«Skriv kortet — buddy ejer transporten, og byg F275 først. Derefter samarbejder du med buddy om at lande dette.»*

---

## 1. Problemet, målt hos en anden session

`fd-sundhed` meldte det selv samme dag:

```
memory-mappe   122 filer · 556 kB
MEMORY.md      27,9 kB mod en grænse på 24,4 kB
98 linjer      for lange
konsekvens     kun EN DEL af indekset loades ved sessionsstart
```

Og hvad det kostede dem, med deres egne ord: *«Jeg havde en memory om samme fejlform og så den ikke.»* De havde skrevet erfaringen ned, den lå på disken, og agenten vidste ikke at den var der.

**To fejl i én, og kun den ene er deres oprydning:**

1. **Indekset har en hård grænse.** Det er en RECALL-grænse: agenten kan ikke se hvad den selv ved. En oprydning udskyder den; den fjerner den ikke — 122 filer bliver til 200.
2. **Viden er låst til én maskine og ét repo.** Der findes ~40 memory-mapper, én pr. repo. Det `fd-sundhed` har lært om hvordan Christian arbejder, er usynligt for Trail, cms og alle andre.

## 2. Hvorfor Trail er svaret, og ikke bare en backup

Trails søgning har ingen 24 kB-grænse. Filen bliver den **lokale cache**; Trail bliver det **søgbare arkiv**. Det er derfor featuren er værd at bygge — ikke for at bevare filerne, men for at gøre dem **findbare på tværs**.

Proven: en agent i ét repo kan slå en erfaring op som en agent i et andet repo skrev ned. Det kan ingen af dem i dag.

## 3. Arkitektur — hvem gør hvad

| | ejer | hvorfor |
|---|---|---|
| **Transport** | **buddy** | Memory-filer skrives af HVER session i HVERT repo. buddy er den eneste der ser dem alle, og den har `trail_save` i forvejen. En hook pr. repo ville være 40 kopier af samme regel. |
| **Modtagelse** | Trail | Trail er flådens langtidshukommelse. Den modtager; den henter ikke. |

**ENVEJS.** Trail skriver aldrig tilbage i en memory-fil. To skrivere på ét lager er husets dublet-fælde, og den har kostet os tid tre gange på ét døgn.

## 4. Afgrænsning — hvad der IKKE sendes

Memory-filer bærer allerede en `type` i deres frontmatter. Kun to af fire sendes:

| type | sendes | hvorfor |
|---|---|---|
| `user` | **ja** | hvem Christian er, hvordan han vil arbejde — fælles for hele flåden |
| `feedback` | **ja** | hvad han har rettet os på, og hvorfor — det dyreste at genlære |
| `project` | nej | repo-lokalt. Hører i det repos eget plan-doc eller kort |
| `reference` | nej | links og dashboards, uden værdi uden for deres kontekst |

At sende alt ville fylde den fælles Brain med 40 repoers lokale noter og gøre den ringere at søge i — det modsatte af formålet.

## 5. **Hvorfor dette kort er blokeret af F275**

Dette er den bærende del af planen, og den er lært på den dyre måde samme dag.

**En memory-fil bliver RETTET over tid.** En agent skriver en note, lærer noget nyt, og skriver den om. Uden F275 er hver rettelse en ny påstand der modsiger den gamle — og modsigelses-linten laver en kandidat pr. fund, og hver kandidat sender ejeren en notifikation.

**Det er ikke en teoretisk risiko. Det skete 16. september 2026:** syv Neuron-skrivninger i `broberg.ai` udløste **61 modsigelses-alarmer** og **100 notifikationer** på Christians telefon. Med 122 memory-filer fra ét repo alene ville tallet være en helt anden størrelsesorden.

**F275 løser det præcist:** filstien er kildens identitet, den nyeste udgave er kanon, og en ny udgave af samme kilde er en AFLØSNING frem for en modsigelse. Derfor:

> **Byg ikke F277 før F275 står som lukket.** Ikke som et forsigtigt råd — som en målt konsekvens.

## 6. Identiteten er FILSTIEN

Ikke indholdet, ikke titlen. `~/.claude/projects/<repo>/memory/<navn>.md` er stabil hen over enhver redigering, og det er netop den egenskab F275 skal bruge.

Bemærk forskellen fra F275's upload-halvdel: dér er identiteten et **fingeraftryk**, fordi et menneske kan lægge den samme fil op under et nyt navn. Her er stien maskin-genereret og stabil, så den ER identiteten. Samme regel, to forskellige beviser — og det skal stå skrevet, ellers kopierer nogen fingeraftryks-mekanikken herind hvor den ikke er nødvendig.

## 7. Reuse (F217 — Discovery-tjek)

- **Transport til Trail** — `mcp__buddy__trail_save` findes og bruges af hele flåden. **Genbruges. Intet nyt bygges.**
- **Kilde-identitet + afløsning** — F275 i dette repo. Genbruges; F277 tilføjer ingen ny mekanik, kun en ny slags kilde.
- **Fil-overvågning** — ingen `@broberg/*`-pakke ejer dette, og buddy har allerede en dæmon der kører. Ingen ny primitiv.
- **Ingen ny provider-integration, intet rå `fetch`.**

## 8. Rollout

1. **F275 lukkes.** Intet sker før.
2. buddy sender ÉT repos `user` + `feedback`-filer. Måles: ankom de, og blev der 0 modsigelses-kandidater?
3. Derefter de øvrige repoer, ét ad gangen.

Trin 2 er porten. Er der ét eneste modsigelses-fund, stopper udrulningen — for så er F275 ikke færdig, uanset hvad dens kort siger.

## 9. Åbne spørgsmål

1. **Hvor ofte?** Ved oprettelse, eller en daglig fejning? Dagligt er billigere og taber intet, da filerne ikke haster.
2. **Hvilken Brain?** CB-M1 (Christians egen) eller en ny fælles «Flådens erfaring»? En egen Brain ville holde 40 repoers noter ude af hans personlige hjerne — men det er hans kald.
