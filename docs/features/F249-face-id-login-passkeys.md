# F249 — Log ind med Face ID (passkeys)

**Status:** planlagt · **Skrevet:** 5. september 2026 (dansk tid) · **Ejer-ordre samme dag**

> «npm pakken @cbroberg/auth skulle have fået nogle tools til at vi kan logge ind
> på en iPhone via FaceID — lav understøttelse for det nu.»

## To ting at rette i præmissen, begge målt

**1. Pakken hedder `@broberg/auth`, ikke `@cbroberg/auth`.** `npm view
@cbroberg/auth` → 404. `cbroberg` er npm-BRUGERNAVNET (maintaineren); scope'et er
`@broberg`. `@broberg/auth@0.5.1` blev udgivet ~2 timer før denne ordre og har
netop det ønskede: en `./passkey`-eksport med WebAuthn via Better Auths
passkey-plugin (SimpleWebAuthn under motorhjelmen).

**2. Det hedder ikke Face ID, og forskellen er ikke akademisk.** Pakkens egen
JSDoc siger det, og det er værd at citere fordi det ændrer hvad vi må love:

> ⚠️ This is DEVICE-OWNER verification, not Face ID. With no Face ID or Touch ID
> configured but a passcode set, iOS falls back to the passcode and still reports
> the user as verified. Never promise a user a face and then accept a four-digit
> code.

WebAuthn kan bede om at enheden **verificerede sin ejer**. Den kan ikke bede om
at det skete med et ansigt. På en iPhone med Face ID slået til ER det Face ID —
men den samme kontrol består med en firecifret kode. UI-teksten skal derfor sige
noget der er sandt uanset hvad telefonen gør.

## Hvorfor det ikke er en installation

Målt i `apps/admin-server` (kontrolplanet, `control.db`):

| | |
|---|---|
| Login i dag | Google OAuth + magic-link, **hjemmelavet** |
| Better Auth | bruges ikke, findes ikke i `package.json` |
| Bruger-model | `control_users`, `oauth_identities`, `magic_links` |
| Session | `sessions.id` **ER** cookie-værdien (usigneret), cookie `trail-session`, 30 dage |
| Multi-tenant | `control_memberships` |

`@broberg/auth` er en tynd wrapper om Better Auth og forudsætter Better Auths
datamodel og sessionshåndtering. Vi har vores egen. Det er hele opgaven.

**Den gode nyhed, målt:** session-udstedelsen er **8 linjer** (`auth.ts:105-112`)
og findes tre steder — magic-link-verify, OAuth-callback og Lens-mint'en
(`lens-session.ts`, F198, som indsætter en `sessions`-række direkte for at give
Lens en read-only adgang). Passkey-ceremonien er stateless: challenge ud, svar
ind, verificér. Lykkes den, udsteder vi de samme 8 linjer. Så indgrebet på VORES
side er lille — det er valget af HVOR ceremonien kører der er beslutningen.

## De tre veje

**(a) Fuld migration til Better Auth.** Alt login flytter. Face ID følger med.
**Forkastet:** rører hver eneste kundes login, kræver datamigrering af brugere og
aktive sessioner, og Lens-mint'en skal skrives om — alt sammen for én feature.
Blast radius står ikke mål med gevinsten.

**(b) Better Auth kun til passkey, mappet til vores egne tabeller.** Better Auth
understøtter `user.modelName`/`fields`, så den kan pege på `control_users` frem
for at oprette sin egen. Vi lader den eje ceremonien + credential-lageret, og
udsteder selv `trail-session` bagefter. **Risikoen der skal lukkes:** ender vi
alligevel med to bruger-tabeller synkroniseret på e-mail, er det præcis den
dublet-drift huset advarer imod — så det er dét spørgsmål der er stillet til
`components` (intercom #25904).

**(c) `@simplewebauthn/server` direkte** mod en ny `passkeys`-tabel med
fremmednøgle til `control_users`. Teknisk renest for os: ét brugerbegreb, én
sessionsmodel, ingen synkronisering. **Men det er et brud på reuse-first** —
`@broberg/auth` ejer passkeys i flåden nu, og husreglen siger at en manglende
evne skal UDVIDES ind i pakken, ikke omgås lokalt. Bygges ikke uden components'
ord.

### AFGJORT 5/9 — af components, målt i pluginnets dist

Spørgsmålet er besvaret (intercom #25913), og svaret lukker **begge** de veje
der stod åbne. Målt i `@better-auth/passkey@1.6.23`s egen `dist`, ikke læst i
dokumentationen:

1. **`verify-authentication` (index.mjs ~461-470) kalder UBETINGET**
   `createSession(passkey.userId)` → `setSessionCookie(...)`. Ingen flag, ingen
   option, ingen gren. **«Bring your own session» er ikke en tilstand pluginnet
   har.**
2. **`afterVerification` fyrer FØR den blok** — så man KAN minte sin egen række
   dér, og requesten fortsætter og laver en **anden** session med en **anden**
   cookie alligevel. To sessionssystemer på ét login. *Fra signaturen alene
   ligner det præcis en opt-out.* Det er dagens gennemgående fejlform igen: et
   hook på det rigtige tidspunkt er ikke den kontrol det ligner.
3. **Registrering kræver en Better Auth-session i forvejen** og afviser når
   `userData.id !== session.user.id`. Vores `trail-session` er usynlig for den.

Derfor er **(b) ikke den udvej den lignede**: punkt 3 tvinger os til også at
mappe SESSION-modellen, og så bliver Better Auth skriveren af vores
sessionsrækker med eget token-felt og signeret cookie. Vores `sessions.id` **ER**
cookien — den ville ændre sig — og Lens-minten, der INSERTER en række direkte,
brækker. Samme blast radius som (a), samlet på den ene tabel vi mindst har råd
til at flytte.

Og **(c) er rigtig i substans, forkert som lokal build**: pluginnet hardkoder
`requireUserVerification: false` i BEGGE ceremonier, så enhver kopi der følger
referencen får et passkey-login der **aldrig tjekker at en biometri skete** — og
det ser perfekt ud. Det er den fælde ethvert repo med egne sessioner ville ramme
hver for sig.

### Vejen der bygges i stedet: en ceremoni-kun-indgang i pakken

components bygger den (deres kort **components-F008.13**): `begin`/`finish` for
begge ceremonier, injiceret store, **returnerer det verificerede bruger-id og
INTET om sessioner.** Vi minter `trail-session` som i dag; Lens-minten røres
ikke. UV-garden følger med.

**Trail er consumer #1** og ejer deres AC#6: at det virker mod `control.db`
rapporterer vi, ikke dem — de kan ikke se vores tabel.

### Vores fakta, sendt til dem (#25915), alle målt i kilden

| | |
|---|---|
| `userId` | vilkårlig TEXT, **to formater i drift**: `u-<hex>` (invite.ts:152), `usr_lens_<hex>` (lens-session.ts:49). En UUID-validering ville afvise præcis Lens-principalen og intet andet — altså kun gå i stykker på den ene bruger ingen tester med. |
| Bruger-oprettelse | store'et må **aldrig**. `organization_id` er NOT NULL med FK, og «hvilken org» er en forretningsbeslutning (invite/onboarding), ikke noget en auth-ceremoni kan udlede. OAuth opretter i øvrigt heller aldrig en bruger (oauth.ts:297 afviser `email_not_registered`) — invite er den eneste vej ind. |
| Session-skrivesteder | **tre**, alle skal forblive urørte: auth.ts:107, oauth.ts:317, lens-session.ts:79 |
| `control_users` | mangler `emailVerified` og `updatedAt` — felter der forudsætter Better Auths brugerform skal være valgfri |
| Multi-tenant | en passkey hører til **BRUGEREN**, ikke til tenanten. En bruger har ÉN org men kan have memberships i flere tenants; en tenant-scopet nøgle ville give en nøgle der virker i ét arbejdsrum og ikke i det andet — for samme person på samme telefon. cb er medlem af to tenants, så det ville ramme ejeren først. |

Grønt felt: der findes **ingen** passkey-/credential-/webauthn-tabel i
`control.db` i dag (0 træf i `apps/admin-server/src`). Der er intet at migrere.

**F249.1 er blokeret indtil indgangen er udgivet.**

## Scope

**Ind:**
- Registrering: en indlogget bruger kan tilføje en passkey fra Indstillinger →
  Konto på den enhed hun sidder ved.
- Login: en knap på login-skærmen der kører passkey-ceremonien og — ved succes —
  udsteder en almindelig `trail-session`. Samme cookie, samme TTL, samme
  `/api/auth/me` bagefter. Resten af appen mærker ingen forskel.
- Flere passkeys pr. bruger (telefon + laptop), med navn, oprettelsesdato og
  sidst-brugt, og mulighed for at fjerne én.
- `requireUserVerification: true`. Pakken har den som `false` som default fordi
  `@better-auth/passkey@1.6.23` hardcoder `userVerification: "preferred"` — men
  for et «lås appen op»-flow ER garantien hele featuren, så den slås til
  bevidst.
- Dark-ship: er passkey ikke konfigureret, vises knappen ikke. Aldrig en død
  knap (pakkens `passkeyConfigured`-guard er lavet til netop det).

**Ude (non-goals):**
- Passkey som ENESTE login. Magic-link og Google bliver, uændret. En bruger der
  mister sin telefon skal kunne komme ind.
- Migrering af eksisterende login til Better Auth (vej (a)).
- Passkeys i motoren (`apps/server`) eller på API-nøgler. Kun kontrolplanets
  brugerlogin.
- Noget der rører Lens-mint'ens sti.

## Sikkerhed — det der skal være rigtigt

- **rpID er bindende og kan ikke laves om bagefter.** En credential registreret
  på `app.trailmem.com` virker kun dér. Vælges det forkert (fx `trailmem.com`
  når appen kører på subdomænet), skal hver bruger registrere igen.
- **Ingen kontoovertagelse via registrering.** En passkey kan kun tilføjes af en
  allerede indlogget bruger til hendes EGEN konto.
- **Challenge skal være engangs og kortlivet**, og bindes til brugeren.
- **Tællere/replay:** Better Auths plugin håndterer det; det skal verificeres,
  ikke antages.
- **`cb@webhouse.dk` er altid admin** — en passkey-tilføjelse må aldrig kunne
  ændre en rolle.

## Verifikation (skitse — udfyldes med AC pr. story)

Passkeys kan ikke drives med et rigtigt ansigt i en headless browser, men
WebAuthn KAN drives: Chrome DevTools Protocol har en virtuel authenticator
(`WebAuthn.addVirtualAuthenticator`) der kan sættes med `hasUserVerification` +
`isUserVerified`. Det giver ægte E2E — registrér, log ud, log ind — og en
NEGATIV kontrol der er selve pointen: med `isUserVerified: false` skal login
AFVISES, ellers beviser det grønne ingenting om `requireUserVerification`.
Om Lens kan drive den virtuelle authenticator er ikke afklaret; kan den ikke, er
det en Lens-gap der files (aldrig en rå Playwright-omgåelse).

Dertil den sædvanlige gem-felt-disciplin: en tilføjet passkey skal LÆSES TILBAGE
fra en frisk indlæsning, og en fjernet skal være væk efter reload.

## Reuse

`@broberg/auth@0.5.1` (components) — Discovery-tjek 5/9: pakken ejer auth
inklusive passkey/WebAuthn i flåden. Derfor er (c) ikke et frit valg, og derfor
er spørgsmålet stillet til ejeren af pakken frem for besvaret lokalt.
`@broberg/mail` bruges allerede til magic-link-mail. Ingen rå provider-SDK'er.

## Rollout

Ship-dark: uden konfiguration findes knappen ikke, og intet eksisterende login
ændrer adfærd. Ingen naked cutover — passkey lægges VED SIDEN AF magic-link og
Google, som begge består uændret.
