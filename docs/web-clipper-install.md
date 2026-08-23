# Trail Web Clipper — installation og opsætning

Klip en hvilken som helst webside direkte ind i din Trail-videnbase med ét klik.

> **Status i dag (23. august 2026):** udvidelsen er endnu ikke udgivet i Chrome
> Web Store, så den installeres manuelt fra den byggede mappe. Når den er
> udgivet, bliver trin 1 til "klik installér", og resten er uændret.
> Se `docs/features/F208-publish-web-clipper.md`.

---

## 1. Installér i Chrome

**[Hent trail-web-clipper-0.1.0.zip](https://github.com/broberg-ai/trail/releases/latest)**
og pak den ud. Du skal hverken have repoet eller bygge noget.

1. Åbn `chrome://extensions`
2. Slå **Developer mode** til (kontakten øverst til højre)
3. Klik **Load unpacked**
4. Vælg den udpakkede mappe
5. Klik puslespils-ikonet i værktøjslinjen og **fastgør** Trail Web Clipper

> **Behold mappen — og flyt den ikke.** Chrome kører udvidelsen *fra* mappen i
> stedet for at kopiere den. Slettes den, flyttes den, eller ryddes din
> Downloads-mappe, dropper Chrome stille udvidelsen — og man opdager det først
> ved næste genstart, hvor ikonet bare er væk. En butiks-installation fjerner
> problemet permanent, fordi Chrome så ejer kopien.

> **Chrome advarer om developer mode ved hver opstart.** Det er Chrome der
> protesterer mod enhver udvidelse der ikke kommer fra deres egen butik — ikke
> en fejl ved vores. Det stopper når butiks-udgaven er godkendt.

**Denne download opdaterer ikke sig selv.** Når butiks-udgaven er godkendt:
fjern denne, og installér derfra.

### Bygge den selv (kun hvis du skal ændre noget)

```bash
cd apps/web-clipper && pnpm build
```

Det producerer `apps/web-clipper/dist` — og det er **dén** mappe der skal
loades, ikke mappen over. Mappen over indeholder TypeScript-kildekode, som
ingen browser kan køre: udvidelsen bliver installeret, men baggrundskoden
starter aldrig, og panelet åbner tomt uden en eneste besked. Kildemappen har
derfor med vilje ingen `manifest.json`, så Chrome afviser den direkte med
*"Manifest file is missing or unreadable"*.

---

## 2. Vælg hvilken Trail den skriver til

Åbn udvidelsen → **Settings**.

| Knap | Adresse | Hvornår |
|---|---|---|
| **Use cloud** | `https://app.trailmem.com` | standard — virker altid, også når din Mac er slukket |
| **Use local** | `http://127.0.0.1:58031` | kun når din egen Trail-server kører |

Vælger du **local**, er et klip tabt hvis serveren ikke kører. Skyen er
standard af netop den grund.

---

## 3. Hent en API-nøgle

Nøglen er det, der beviser at klippet er dit. Udvidelsen leveres **uden**
nøgle — den skal du hente selv, én gang.

1. Åbn den Trail du valgte ovenfor — for skyen: <https://app.trailmem.com>
2. Gå til **Settings → Developer**
3. Klik **Generate new key**
4. **Kopiér nøglen med det samme** — den vises kun én gang
5. Tilbage i udvidelsen: **Settings → API Token** → indsæt → **Save & Connect**

Nøglen skal høre til den server du valgte. En nøgle fra din lokale Trail
virker ikke i skyen og omvendt — det er to forskellige systemer.

---

## 4. Klip en side

1. Gå til en artikel
2. Klik Trail-ikonet
3. Vælg videnbase, skriv eventuelt nogle tags
4. **Clip**

Statuslinjen nederst viser hvilken Trail klippet lander i, **før** du klikker.

---

## Når noget ikke virker

Udvidelsen siger hvad der faktisk gik galt — den fejler ikke i tavshed:

| Besked | Betydning | Løsning |
|---|---|---|
| `Not configured — add your API token in settings` | ingen nøgle indsat endnu | trin 3 |
| `Can't reach <adresse>` | serveren svarer ikke | kører den lokale Trail? er adressen rigtig? |
| `<adresse> refused the API token (401)` | serveren svarede, men afviste nøglen | nøglen er spærret eller hører til den anden server — lav en ny |
| `Content script did not respond` | siden nåede ikke at svare | genindlæs siden og prøv igen |

Chrome-sider (`chrome://…`), Web Store og PDF-visninger kan af princip ikke
klippes — browseren tillader ikke udvidelser at læse dem.

---

## Hvad udvidelsen har adgang til

Den beder bevidst om så lidt som muligt:

| Tilladelse | Hvorfor |
|---|---|
| `activeTab` | læse siden du er på — **kun i det øjeblik du klikker** |
| `scripting` | køre udtrækkeren på den side, på dit klik |
| `storage` | huske adresse og nøgle på din egen maskine |
| adgang til `app.trailmem.com` + `127.0.0.1` | de to Trail-servere den må uploade til |

Der er **ingen** permanent baggrundskode på de sider du besøger. Udtrækkeren
indsprøjtes ved klikket og forsvinder igen. Bruger du en anden Trail-adresse,
spørger browseren om lov til netop den adresse på dét tidspunkt.

---

## Safari

Kommer, som en signeret Mac-app (Safari tillader ikke rene webudvidelser).
Signerings-certifikatet er på plads siden 23. august 2026 — se
`docs/features/F208-publish-web-clipper.md`, story F208.5.
