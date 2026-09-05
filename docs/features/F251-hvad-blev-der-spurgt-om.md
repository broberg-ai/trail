# F251 — Hvad blev der spurgt om, og hvad kunne vi ikke svare på

**Status:** planlagt · **Skrevet:** 5. september 2026 (dansk tid)

> «Stats for hvor mange søgninger der er foretaget af kundeløsninger, og hvad der
> er søgt på, chattet om. Er det for vildt at gemme i trail?»
>
> «Hvordan definerer en klient-chat at svaret ikke fandtes hos os, og kan den
> primes til at respondere på det?»

## Præmissen er omvendt af den antagne

**Vi gemmer det allerede.** Målt 5. september, i koden og på prod:

- `apps/server/src/routes/chat.ts:303` kalder `persistTurnPair` for **alle**
  audiences — også `public`, altså widget'en på en kundes site.
- Hver besøgendes ord ligger i `chat_turns.content`, med `citations`, under den
  bruger API-nøglen autentificerer som.
- **Ingen sletning af `chatTurns` findes nogen steder i `apps/server/src`.**
  Der er ingen udløbsdato.
- **12 chat-sessioner i `sanne-andersen`** (kun ANTAL talt — intet indhold læst).

Spørgsmålet er altså ikke *om vi skal begynde at gemme*. Det er om at **beslutte
noget vi allerede gør utilsigtet.** Og det flytter hastesagen: den halvdel der
lyder som en fremtidig risiko er nutid.

## Hvorfor svarteksten ikke kan bruges som signal

Det oplagte svar på ejerens første spørgsmål er «led efter *det ved jeg ikke* i
svaret». **Det ville måle noget vi selv har gjort usynligt.**

`apps/server/src/assets/personas/chat-public.md` instruerer eksplicit modellen i
det modsatte:

> **When the knowledge base doesn't have the answer** — Don't say "I can't help"
> — that closes a door. Give a brief, empathetic generic response … and suggest
> the visitor reach out directly.

Det er en **god produktbeslutning**: en lukket dør er dårlig service. Men
konsekvensen er at et ubesvaret spørgsmål i dag ligner et besvaret, med vilje.
Enhver tekst-baseret detektion ville måle vores egen prompt.

## Tre tilstande, ikke to

`CHAT_HIDE_BELOW` (0.3, `chat-confidence.ts`) skjuler Neuroner under et
tillids-gulv. Derfor er «vi kunne ikke svare» ikke én tilstand men **tre**, og de
kræver hver sin handling:

| Tilstand | Hvad der skete | Kuratorens handling |
|---|---|---|
| **Intet fundet** | 0 hits i vidensbasen | skriv en ny Neuron |
| **Filtreret væk** | hits fandtes, men lå under tillids-gulvet eller var afløst | **opdatér** den gamle Neuron |
| **Utilstrækkeligt** | synlige hits, men de besvarede ikke spørgsmålet | skriv den **bedre** |

En enkelt boolean ville slå dem sammen til «vi mangler noget» — og den midterste
er den mest interessante, fordi svaret **fandtes** og alligevel ikke nåede frem.

## Signalet: to uafhængige kilder, aldrig slået sammen

1. **Retrieval** (hårdt, maskinelt): hvor mange Neuroner kom tilbage, hvor mange
   blev skjult af gulvet. Et faktum, ikke en fortolkning.
2. **Modellens egen erklæring** (blødt): et struktureret felt ved siden af
   prosaen — «kunne jeg svare?» — ikke noget der skal læses ud af teksten.

De gemmes **hver for sig**, fordi de fejler forskelligt. Den mest værdifulde
aflæsning er når de er **uenige**: der var materiale, og modellen kunne ikke
bruge det. Det er et signal om at Neuronen er dårligt skrevet — ikke at den
mangler. Slår man dem sammen, forsvinder præcis den oplysning.

## Kan chatten primes til at svare på det? Ja — men ikke med samme mekanisme

Ejerens andet spørgsmål, og fælden i det:

**Primer man modellen hårdere til at indrømme uvidenhed, bliver den forsigtig.**
Antallet af «ubesvarede» stiger, uden at videnshullerne er blevet flere. Så ville
statistikken måle vores egen prompt frem for kundens vidensbase — og pilen ville
pege opad netop når vi gjorde produktet mere ærligt.

Derfor er reglen: **primingen ændrer hvad brugeren LÆSER. Retrieval afgør hvad vi
TÆLLER.** De må aldrig være samme mekanisme, og F251.4 har et AC der beviser det —
samme spørgsmål gennem to forskellige personaer skal give **samme** tilstand.

Selve invitationen er billig og god: *«Det kan jeg ikke svare præcist på ud fra
det jeg har — men skriv til Sanne, så finder I ud af det.»* Med en konkret vej
videre frem for en blindgyde.

## Grænsen der bygges ind, ikke tilføjes

**Der må aldrig findes en forespørgsel der returnerer besøgendes spørgsmål på
tværs af tenants.** Sannes kunders ord er hendes ansvar, ikke vores at læse på
tværs af huset. Det står som et AC der kan fejle (F251.3), mutations-bevist ved
at fjerne tenant-prædikatet.

Dertil:
- **Tællinger** er persondata-frie og bygges **først** — så den svære halvdel
  ikke blokerer den nemme.
- **Fritekst** gemmes kun i kundens egen Trail, uden noget der identificerer den
  besøgende, og med en **udløbsdato håndhævet af en kørende oprydning** — ikke af
  en kommentar.

## Det der allerede findes, og som derfor ikke skal bygges

| | |
|---|---|
| `chat_turns` med `content` + `citations` | findes — citations ER retrieval-signalet, delvist |
| `chat-confidence.ts` med gulv + pin + supersede | findes — kilden til den midterste tilstand |
| `/neurons/queries/` som Neuron-type | **findes i koden** (`orphans.ts:384`), aldrig taget i brug — 0 af 241 Neuroner |
| `activity_log` | findes, men logger ikke søgning/chat |
| Relevans-score på søgning | findes ikke — skal med for at kunne skelne «utilstrækkeligt» |

## Non-goals

- Ikke et analytics-produkt. Trail er en vidensbase; tallene findes for at
  besvare «bliver den brugt» og «hvad mangler vi», ikke for at være et dashboard.
- Ingen sammenligning af kunder mod hinanden.
- Ingen ændring af hvad chatten svarer i de tilfælde hvor den **kan** svare.

## Rollout

F251.2 (tællinger) kan ship'e alene og har værdi alene. F251.1 er grundlaget for
resten. F251.3 og .4 kræver en beslutning fra ejeren om **udløbsfristen** på
fritekst — den er hans, ikke vores, og den er skrevet som et åbent punkt frem for
et gæt.

## Åbne spørgsmål

1. **Hvor længe må et besøgendes spørgsmål gemmes?** 30 dage? 90? Beslutningen er
   ejerens. Indtil den er truffet, bygges F251.3 ikke.
2. **Skal den eksisterende fritekst i `chat_turns` fra public-chats ryddes op med
   tilbagevirkende kraft?** Der ligger data i dag som ingen har besluttet at
   gemme. Det er en sletning på prod og kræver derfor hans direkte ord.

## Reuse

Discovery-tjek: ingen `@broberg/*`-pakke ejer søge-telemetri eller
chat-analytics. `upmetrics` ejer fejl- og omkostnings-telemetri, men et
ubesvaret spørgsmål er ikke en fejl — det er et kuraterings-signal, og det hører
til i den vidensbase det handler om. `@broberg/ai-sdk` bruges allerede til
LLM-kaldene og leverer token/omkostnings-tal; de skal ikke tælles igen her.
