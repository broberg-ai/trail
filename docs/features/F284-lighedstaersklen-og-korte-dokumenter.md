# F284 — Lighedstærsklen er kalibreret på den forkerte dokumentstørrelse

**Status:** Backlog · 19/9 2026 · fundet under F277's første rigtige kørsel

## Hvad der sker for produktet

En memory-fil på 203 ord blev rettet: ét værktøjsnavn udskiftet, og et afsnit
på fem linjer tilføjet der forklarer rettelsen. Helt normal vedligeholdelse.

Trail svarede **`name-collision`** — den HØJESTE alarm, som betyder «to
forskellige værker slås om ét navn».

Det er det forkerte svar om en fil der bare er blevet rettet.

## Målingen

    lighed            42 af 64 pladser ens = 0,656
    tærskel           0,85
    gammel fil        203 ord
    ny fil            273 ord  (+34 %)
    ændrede linjer    10

Udregningen er KORREKT. Koden gør præcis hvad den skal.

## Årsagen

Jeg byggede og prøvede F275.6 mod en **40-siders årsrapport**, hvor Christians
eget eksempel var «kun årstallet er ændret». I et langt dokument flytter den
slags rettelse næsten ingenting, og 0,85 var en fornuftig grænse.

MinHash arbejder på 5-ords vinduer. I et dokument på 203 ord er der ~199
vinduer. Tilføjes 70 ord, er ~70 vinduer nye — altså omkring en tredjedel.
Jaccard-ligheden falder til ~0,74 af den grund alene, og udskiftningen af et
ord midt i teksten trækker den resten af vejen ned til 0,656.

**Spørgsmålet målingen svarer på er ikke det spørgsmål jeg troede jeg stillede.**
«Hvor stor en ANDEL af teksten er ny» og «er det det samme dokument» er det
samme spørgsmål for et langt dokument og to forskellige for et kort.

## Hvorfor det betyder noget netop nu

**Memory-filer er præcis det korpus der bliver rettet igen og igen**, og de er
korte af natur — én note, ét forhold. Med den nuværende tærskel fyrer den
højeste alarm på den mest normale hændelse i hele korpusset.

Det er den støj F277 skulle fjerne, opstået i det felt der skulle fjerne den.
Samme form som resten af ugen: noget så rigtigt ud og var det ikke.

## Hvad der IKKE er galt

**Beskeden er forkert. Mekanismen er rigtig.**

Afløsningen kører på kilde-IDENTITET, ikke på lighed — et bevidst valg i
F275.6. Målt i samme kørsel: to udgaver af filen, ÉN unik identitet, **0
modsigelses-kandidater**. De blev behandlet som én kilde i to udgaver, præcis
som de skulle.

Skaden er altså en dårlig besked til mennesket, ikke tabt eller forvansket
viden. Det er grunden til at kortet er `high` og ikke `critical`.

## Mulige veje, ingen valgt endnu

De står her som åbne spørgsmål, ikke som en plan — valget kræver flere
målinger end den ene hændelse vi har:

1. **Tærskel efter dokumentlængde.** Lavere krav for korte dokumenter. Enkelt,
   men indfører et nyt tal der også skal kalibreres — og på hvad?
2. **Kortere vinduer for korte dokumenter.** 3-ords vinduer i stedet for 5
   gør målingen mindre følsom over for tilføjelser. Ændrer aftrykkets form,
   så alle eksisterende aftryk skal regnes om.
3. **Indeslutning frem for lighed.** Spørg «hvor meget af den GAMLE tekst er
   stadig i den nye» i stedet for «hvor ens er de». En ren tilføjelse giver
   da 1,0. Det er formentlig det rigtige spørgsmål for en rettet fil — men
   det er en anden måling, ikke en justeret tærskel.
4. **Lad navnesagen kende kildens type.** En memory-fil og en årsrapport er
   ikke samme slags dokument og behøver ikke samme grænse.

**Non-goal: at hæve 0,85 til et lavere tal uden en måling.** Det ville gøre
netop denne hændelse grøn og flytte fejlen et andet sted hen, hvor den er
sværere at se. Vi har ÉT målepunkt; det er for lidt til at vælge et tal.

## Reuse

Ingen `@broberg/*`-pakke ejer en lighedsmåling — søgt på Discovery for
«similarity», «minhash» og «fingerprint». Det er Trails egen kode
(`packages/shared/src/fingerprint.ts`), og rettelsen hører hjemme dér.

## Historier

Skrives når vejen er valgt. Første skridt er at MÅLE: kør ligheden over de
40 memory-filer der nu ligger i agent-memory, og se hvordan den fordeler sig
for rigtige rettelser af rigtige korte filer. Én hændelse er en anekdote.
