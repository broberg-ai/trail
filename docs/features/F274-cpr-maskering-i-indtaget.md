# F274 — CPR-maskering i indtaget

> Status: plan. Oprettet 15. september 2026. **Ikke påbegyndt** — afventer
> ejerens ord på den ene beslutning der er hans (se nedenfor).

## Hvordan den opstod

Under et opslag i CB-M1 den 15. september fandt jeg en Neuron fra 10/9 kl.
18:00 med Christians eget CPR-nummer i klartekst. Ambient havde opsamlet det
fra skærmen.

Hans svar om sit EGET nummer lukkede den del: *«Nej fuck mit CPR det er kun
mig der har adgang til den brain.»* Den sag er slut, og der ryddes ikke op i
CB-M1.

Men han omformulerede opgaven i samme åndedrag:

> «Men hvis det skal have nogen mening så skal Trail jo selv have den
> funktionalitet at den maskering sker under compile måske endda før, og
> nogle external sources får lov at skrive neuroner direkte.»

Det er den rigtige ramme, og den er større end hans eget nummer.

## Hvorfor en oprydning ikke er svaret

En engangs-scanning af CB-M1 er **forældet i det øjeblik den næste kilde
skriver**. Eksterne kilder skriver Neuroner direkte ind i basen; en scanning
kørt om aftenen dækker ikke det der lander natten efter. Maskeringen hører
derfor til på INDTAGS-stien, ikke i et script.

Det er også hvorfor det ikke kan ligge hos en peer-session: den ville køre
den én gang og melde grønt.

## Den ene beslutning der ikke er vores

«**under compile, måske endda før**» — de to er ikke det samme:

| | hvad der ligger på disk bagefter |
|---|---|
| **maskér FØR persistering** | det rå CPR lander aldrig. Uigenkaldeligt — og det er meningen. |
| **maskér ved compile** | det rå ligger stadig i basen; kun det kompilerede output er rent. Altså en kopi tilbage i præcis den base RAG søger i. |

**Anbefaling: før persistering.** Argumentet er ikke hans eget nummer, men
patienternes: et CPR der aldrig nåede disken kan ikke lække fra en base, en
backup eller et snapshot. Den strenge vej koster at en fejlagtig maskering
ikke kan fortrydes — og det er den rigtige pris.

**Dette er ejerens kald.** Planen bygges ikke før han har sagt hvilken.

## Tre ting der skal stå i koden, ikke kun her

### 1. Modulus-11 må IKKE bruges til at validere et CPR

Siden 2007 er kontrolcifferet opgivet for en del numre. **Ægte CPR-numre
består ikke modulus-11-testen.** Validerer man på den, smider man ægte numre
væk som falske positive — altså fejler man i den farlige retning: de slipper
umaskeret igennem.

Match på **FORM** (DDMMYY + 4 cifre, med eller uden bindestreg) og acceptér
hellere en falsk positiv. En maskeret ordrenummer er en kosmetisk fejl; et
umaskeret CPR er en anmeldelsespligtig.

### 2. Datodelen er det der gør mønsteret brugbart

Ti vilkårlige cifre er også ordrenumre, telefonnumre og commit-ting. Kræv at
de første seks er en gyldig dag/måned. Det er forskellen på en maskering man
beholder og en man slår fra efter en uge.

### 3. Beviset er en POSITIV KONTROL på HVER indtags-sti

Skriv et realistisk formet CPR ind gennem hver eneste vej ind i basen —
Ambient-relayet, upload-pipelinen, `wiki-write`, `POST /queue/candidates` og
den eksterne kilde der skriver Neuroner direkte — og læs rækken tilbage fra
en **frisk hentning**, ikke fra svaret på skrivningen.

Én sti uden kontrol er præcis den der slipper det igennem, og det opdages
ikke ved at læse koden. Stierne skal tælles i repoet før prøverne skrives —
ikke huskes.

## Reuse

`@broberg/secret-scan` (components, 35+ nøgleformater, `redactSecrets` /
`hasSecret` / `classify`) er flådens maskerings-primitiv, og Trail bruger den
allerede via `@trail/shared`. **Den kender så vidt målt ikke CPR.**

Flåde-reglen er at UDVIDE den frem for at rulle en lokal kopi — så dækker den
hver eneste session på én gang. Tilføjelsen af CPR-mønsteret hører derfor
hjemme hos **components**; vores arbejde er at kalde den på indtags-stien.

Måles før der bygges: hvad `secret-scan` faktisk kender i dag — ikke hvad
dens beskrivelse siger.

## Non-goals

- Ingen oprydning i eksisterende Neuroner. Ejeren har afvist den for sit eget
  nummer, og en oprydning løser ikke den næste skrivning.
- Ingen anden persondata-klasse i denne omgang (pas, kørekort, kontonumre).
  De hører til samme primitiv, men ikke til dette kort.
- Ingen ændring af hvem der må skrive direkte.

## Åbne spørgsmål

1. Før persistering eller ved compile? **Ejerens kald.**
2. Skal en maskering være SYNLIG i Neuronen («[CPR maskeret]») eller lydløs?
   Synlig er at foretrække — et lydløst indgreb kan ikke skelnes fra at der
   aldrig stod noget.
3. Skal indtaget AFVISE en kilde der bugner af CPR, frem for at maskere den?
