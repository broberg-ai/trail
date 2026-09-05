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

**Åbent spørgsmål, og planen venter på det:** er (b) en dokumenteret vej, eller
er «passkey uden Better Auth-session» en gap components vil have filet? Spurgt
5/9, intercom #25904.

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
