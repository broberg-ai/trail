# F272 — Brain-listen målte hele disken forfra ved hvert kald

> **Denne plan-doc er skrevet BAGUD, 15. september 2026.** Arbejdet blev udført
> 11. september under et kørende produktionsnedbrud, hvor ejeren selv rapporterede
> fejlen mens han sad i produktet. F180.6 tillader at KORTET følger efter ordren i
> den situation — men det skal lande i SAMME TUR som rettelsen, og det gjorde det
> ikke. Fire commits (08bb7f6, f62a3fc, b867209, 51aaa2d) pegede på et F-nummer
> uden kort i fire døgn. Filen her lukker hullet og skjuler det ikke.

## Hvad der skete

`GET /api/v1/knowledge-bases` — den forespørgsel Brain-listen tegnes fra — tog
**154 sekunder**, mens hvert andet endpoint svarede på under et halvt sekund.
Skærmen timede ud, og produktet var ubrugeligt.

## Root cause

`kbSizes` lavede **ét `stat()`-kald pr. række i `document_images`** for at kunne
skelne *påståede* bytes fra *tilstedeværende* bytes. 743 billedrækker, én delt
vCPU, og det lå på den vej en skærm tegnes fra.

**Den blev ikke udløst af en sletning.** Rutens egen kommentar sagde allerede
«501 MB forældreløse målt 2026-09-02»; problemet havde vokset i ni dage. Jeg
påstod først over for ejeren at min sletning var årsagen. Det var forkert:
sletningen gjorde det **synligt**, ikke sandt.

## Den forkerte rettelse, og hvem der fangede den

Første forsøg var en 60-sekunders cache. Ejeren stoppede den med ét spørgsmål:

> «Hvorfor skal målingen laves hvert minut hva måler den? Har du hørt om cache?»

Han havde ret, og målingen viste hvorfor: første kald 3,6 s, derefter **tre
timeouts på 90 s** — samtidige kald rammer alle forbi cachen, så den flyttede
kun problemet. En cache foran en måling der ikke burde finde sted er en
symptom-skjuler.

**Den rigtige rettelse var at fjerne disk-opslaget fra request-vejen helt.**
Resultat: **0,24 s**.

## Den tredje tilstand — `imageMissingCount: number | null`

Her ligger den bærende beslutning, og den er ikke en optimering.

Da opslaget forsvandt fra listen, var det nærliggende at svare `0` manglende
filer. **`0` betyder «alle filer er der».** Sandheden var «ingen har kigget».
De to er ikke det samme, og forskellen er usynlig fra kaldestedet.

`null` = **ikke målt**. `kbSizes(trail, tenant, null)` rører aldrig disken, og
svarer `imageMissingCount: null` samt `totalBytes === totalBytesClaimed` — den
påstår altså ikke et afvig den ikke har målt.

Prøven har en **positiv kontrol på spionen selv**: uden den ville «0 kald» også
bestå hvis `kbSizes` holdt op med at læse billedrækker overhovedet.

## F272.2 — kontrakten med buddy

Samme runde afslørede en anden usynlig kobling: buddys probe-job poller
`GET /api/v1/documents?awaitingLocalCompile=true` hvert andet minut og læser
felterne `documents` og `ids`. **En omdøbning i vores ende ville have gjort
deres probe tavs** — den læser en manglende sti som «0 der venter».

Første vagt læste vores KILDEKODE og beviste at navnene stod i filen. Det er en
svagere påstand end den ser ud: den ville være grøn hvis ruten var flyttet, hvis
en middleware svarede før den, eller hvis et kald gav 500. `verify-probe-kontrakt.ts`
måler derfor det **levende svar** for begge tenants buddy faktisk poller.

## Non-goals

- Ingen maskinopgradering. Motoren kører stadig 1 delt vCPU / 1 GB; rettelsen
  var at lade være med at lave arbejdet, ikke at købe sig ud af det.
- De forældreløse billedrækker er IKKE ryddet op her. Det er egen sag
  (Trail Research' 91 døde billed-poster, som ejeren har sagt FIX og ikke SLET).

## Reuse

Discovery-tjek gennemført. Ingen `@broberg/*`-primitiv dækker «mål ikke disken
på request-vejen» — det er en rutespecifik beslutning i vores egen kode, ikke
en flåde-kapabilitet. Ingen ny afhængighed hentet ind.
