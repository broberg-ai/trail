# F252 — Kilde-sider formerer sig

**Status:** planlagt · **Skrevet:** 5. september 2026, sent (dansk tid)

## Hvordan det blev fundet

Jeg rapporterede tidligere på dagen at Aidan-artiklen lå som **fem kilde-sider**
i broberg-ai, og spurgte om jeg skulle finde ud af hvorfor. Spørgsmålet blev
besvaret to timer senere — ikke ved at lede, men ved at **se mekanismen ske tre
gange på én aften.**

## Målingen

**Omfanget** (broberg-ai, 5/9 kl. 23:50):

```
39 kilde-filer findes som 90 sider
  5×  aidan-assistenten-der-voksede-op-her
  4×  alle-nyheder · seletøjet-ikke-agenten · grøn-og-alligevel-i-stykker
  3×  tanker · tags · fd-sundhed-16-838-ansatte
  2×  … tolv flere
```

**Mekanismen**, målt på ét dokument i drift:

| Tidspunkt | Hændelse |
|---|---|
| 4/9 17:50 | `ai-metode_selen-ikke-agenten.md` oprettes (doc `3580bdd2`) |
| 5/9 23:41 | jeg rydder `awaitingLocalCompile` via `/local-compiled` |
| 5/9 23:43:55 | dokumentet står **igen** som `status='processing'` + `awaitingLocalCompile=true` |

To ruter blev udelukket ved at læse dem: `/local-compiled` sætter
`status: 'ready'`, og `/local-recompile` gør det samme. Ingen af dem kan have
gjort det.

Det gør **`uploads.ts:357`**: en GEN-UPLOAD af samme filnavn opdaterer det
eksisterende dokument til `status: 'processing'` og sender `localCompile` med,
hvorefter `processFileAsync` sætter flaget igen. Altså: **broberg-ai-sitets
synkronisering lægger artiklen i køen på ny**, og hver runde skriver en frisk
kilde-side ved siden af den forrige.

## To adskilte problemer

**(a) Syncen re-uploader indhold der ikke har ændret sig.** Ikke vores repo.
Værd at melde videre, men det er ikke der rettelsen hører.

**(b) Kompileringen laver en dublet frem for at opdatere.** Vores. Det er dét
der gør (a) dyrt: uden (b) ville en overflødig sync bare være spildt arbejde;
med (b) vokser vidensbasen for hver.

## Hvorfor det er værre end rod

Dubletterne er **ikke identiske.** De fire `seletøjet`-sider er skrevet af fire
forskellige kørsler, af en model, på fire tidspunkter — så de kan være
formuleret forskelligt og lægge vægt forskelligt.

**En søgning kan altså i dag give tre forskellige svar på samme spørgsmål, uden
at nogen kan se hvilket der er nyest.** Det er ikke støj i en liste; det er
uenighed inde i vidensbasen.

## Rettelsen hører i ingesten

`wiki-write` med `command=create` under `/neurons/sources/` skal slå op på
**kilde-filnavnet** (frontmatterens `sources`) før den opretter. Findes en side
for samme kildefil, opdateres den — med versionshistorik, så en ændret artikel
stadig kan ses at have ændret sig.

**Opslaget sker på filnavn, ikke på titel.** Den danske og den engelske udgave
af samme artikel har samme emne og skal netop have hver sin side.

## Rækkefølgen er ikke vilkårlig

Oprydningen (F252.2) kommer **efter** rettelsen (F252.1). Rydder man først, er
bunken tilbage inden for en uge — sitet redigeres løbende — og man har brugt en
sletning på ingenting.

Og en sletning i en KUNDES vidensbase kræver ejerens direkte ord. F252.2 bygges,
men køres ikke uden.

## Non-goals

- Ikke at ændre site-syncen. Den ligger i et andet repo, og rettelsen her gør
  dens overflødige uploads harmløse frem for dyre.
- Ikke at slå re-kompilering fra. En ÆNDRET artikel **skal** kompileres igen —
  det er kun dubletten der er forkert, ikke gentagelsen.

## Reuse

Discovery-tjek: ingen `@broberg/*`-pakke ejer ingest eller wiki-skrivning. Det
er Trails egen kerne (`packages/core/src/ingest/`).
