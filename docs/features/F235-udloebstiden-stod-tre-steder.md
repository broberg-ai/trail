# F235 — udløbstiden stod tre steder, og de to en kunde læser var dem intet ville fange

**Kort:** trail-F235 · story · medium · **rettet i samme tur**

## Hvordan det blev fundet

cardmem meldte at Trails to mail-skabeloner blev afvist (`sourcePath` pegede på
`.ts`-filen skabelonen genereres FRA, som deres synk-tjek hasher som en
indsendelse). Verificeret uafhængigt mod `/api/mail-templates/sync`:

```
magic-link  enduser   … apps/admin-server/src/email.ts is not valid JSON
team-invite internal  … samme
```

Deres diagnose holdt. Men mens jeg tjekkede om vores egen skabelon i det hele
taget sagde sandheden, faldt et større problem ud.

## Tre kopier af ét tal

```
auth.ts            MAGIC_LINK_TTL_MIN = 15        ← håndhæver det
email.ts           "expires in 15 minutes"        ← brugeren LÆSER det
cardmem-skabelon   "expires in 15 minutes"        ← modtageren LÆSER det
```

**De to en kunde faktisk læser var dem intet ville fange.** Ændrer nogen
TTL'en, bliver linket ugyldigt tidligere — og brevet bliver ved med
selvsikkert at love femten minutter. Ingen fejl, intet signal, og den der
lider under det er præcis den der stolede på sætningen.

Tallet er rigtigt i dag. Det er ikke pointen.

## Rettelsen — og hvorfor konstanten ikke bare blev eksporteret

Første forsøg var `export const MAGIC_LINK_TTL_MIN` i `auth.ts` og en import i
`email.ts`. **Det lukker en import-cirkel:** `auth.ts` importerer allerede
`sendMagicLink` fra `email.ts`.

Den ville have virket i dag — værdien læses kun inde i en funktion, efter begge
moduler er evalueret — og gået i stykker første gang nogen læste den på
modul-niveau. **En cirkel der virker ved held er værre end en der fejler**,
fordi intet markerer den.

Konstanten fik derfor sit eget modul, `apps/admin-server/src/ttl.ts`.

## Prøven asserter på BREVET, ikke på konstanten

En prøve der læser konstanten to gange beviser kun at en variabel er lig sig
selv. Denne læser `email.ts` og kræver at der **ikke findes et bart
«expires in \<tal\> minutes»** nogen steder — altså at tallet er interpoleret.

Mutations-bevist: hardkodes tallet tilbage i brevet, bliver præcis den prøve rød.

## Og admin-serveren havde slet ingen prøver

Opdaget undervejs: `apps/admin-server/package.json` havde **intet
`test`-script**. Kontrolplanet — login, sessioner, tenants, invitationer,
API-nøgler — kørte ingen prøver i porten overhovedet. Nu gør det.

## Skabelon-valget: (b), og det er et rigtigt svar

cardmem tilbød to veje. Valgt: **udelad `sourcePath`.**

Trails brev er elleve linjer inline HTML — en systemskrifttype og én grøn knap.
At udsende et JSON-artefakt i CI og holde det synkront for evigt, så en
flåde-statusmail kunne bære elleve linjer HTML, er ikke værd at vedligeholde.

**Og det afgørende:** Trail sender selv sit eneste kundebrev. cardmem sender
aldrig magic-linket. Alt cardmem sender på Trails vegne er flåde- og
projektpost — og dér er cardmems eget design det rigtige.

Skabelonerne bliver stående som **dokumentation** af hvordan Trails brev ser ud,
med afsender-forbeholdet (`webhouse.dk`, ikke `trailmem.com`) skrevet ind, så
enhver der sender på vores vegne kan se det. De vil fortsat læse `unknown` og
blive afvist. Det er hensigten.

**Skabelonens egen «15 minutes» er nu den sidste tilbageværende kopi** — og det
er endnu en grund til at cardmem skal sende sit eget brev frem for et forældet
et af vores.
