# F233 — den samme Trail findes to steder, med samme id og forskelligt indhold

**Kort:** trail-F233 · epic + F233.1 · medium

## Hvad der er målt

`6aa52746-d235-464c-b038-d7e1965e3622` — ét KB-id, to tenants, to databaser:

| | dokumenter | billeder | nyeste dokument |
|---|---|---|---|
| **broberg-ai** | 88 | 650 | **5. maj 2026** |
| **sanne-andersen** | 321 | 1.557 | **6. juni 2026** |

Samme id. Samme slug. Samme navn, *«Sanne Andersen»*. Forskelligt indhold, og
broberg-ai-kopien har ikke fået et nyt dokument i **en måned**.

Det er efterladenskaberne fra F40.2a, hvor Sanne fik sin egen tenant. Kopien
blev aldrig fjernet.

## Hvorfor det ikke bare er rod

**Den kostede en falsk alarm samme aften den blev fundet.** Efter en migration
talte jeg Sannes billeder for at bevise at galleriet ikke var blevet tømt. Jeg
brugte `X-Trail-Tenant: broberg-ai`, fik **650** mod de 1.557 jeg havde målt en
time tidligere, og var i færd med at rapportere at **907 af en kundes billeder
var forsvundet.**

De var der. Jeg havde spurgt den forkerte database.

**Og intet i svaret kunne afsløre det.** Samme id, samme navn, ingen advarsel,
ingen fejl — bare et mindre tal. Det er husets gennemgående fejlform i sin
reneste form: **ét signal, to kendsgerninger**, og den fejler i den grønne
retning når man leder efter noget andet, og i den røde når man leder efter
netop dette.

**Adgangen er i orden.** `resolveKbId` er tenant-scopet og hver læsning blev
inde i sin egen tenants database. Der er ikke lækket noget. Problemet er ikke
sikkerhed — det er at **to ting der ikke er den samme har det samme navn.**

## Scope

**F233.1 — gør forskellen synlig, før nogen beslutter noget.** Et svar fra
`/knowledge-bases` skal kunne skelnes: hvilken tenant, hvor mange dokumenter,
hvornår sidst rørt. En kalder skal ikke kunne tro at den har fat i den anden.

**Non-goals, og det er en bevidst grænse:**

- **Vi sletter ikke kopien.** Det er en destruktiv handling på en tenant med
  kundedata, og den kræver ejerens eget ord. Den kan også vise sig at være i
  brug til noget.
- Vi omdøber ikke noget uden hans beslutning — navnet er det, en kurator
  genkender.

## Spørgsmålet til ejeren

**Skal broberg-ai-kopien væk?** Den er en måned bagud, den fylder disk, og den
er en fælde for enhver — menneske eller session — der rammer den forkerte
tenant. Men den er også en komplet kopi af Sannes materiale fra 5. maj, og det
kan være tilsigtet.

Indtil han svarer, står den. **Kortet findes for at spørgsmålet ikke bliver
glemt igen** — det har ligget usynligt siden maj.
