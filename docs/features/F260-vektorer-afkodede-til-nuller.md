# F260 — semantisk søgning var død: alle vektorer afkodede til nuller

**Status:** shipped (6. september 2026) · **Kind:** epic

## Motivation

Ejeren: *«Så hybrid søgning til.»*

Flaget `hybrid_search_enabled` stod på **0 på alle elleve videnbaser**. Hele
den semantiske søgning var bygget og aldrig tændt. Det var rigtigt at tænde
den — men da jeg skulle bevise at den virkede, gjorde den ikke.

## Målt på produktion, led for led

```
coverage        1205 chunks, 1205 embedded, ratio 1.0     ← så perfekt ud
embed(query)    OK, 1024 dims, sum(|x|) = 25,49           ← forespørgslen fin
loadVectors     1205 rækker                               ← alle hentet
cosine          null for ALLE 1205                        ← her

gemt vektor     sum(|x|) = 0,0000
rå bytes i DB   4096 bytes · dims=1024 · «0080F2BC…» = −0,0296   ← data ER der
```

Skrivningen var korrekt hele tiden. **Læsningen lavede rigtige tal om til nuller.**

## Root cause — en tavs ingenting

libsql leverer et BLOB som **`ArrayBuffer`**, ikke som `Uint8Array`.

```ts
const copy = new Uint8Array(b.byteLength);
copy.set(b);                    // ← en ArrayBuffer har ingen `length`
```

`set` forventer noget array-agtigt. En ArrayBuffer har ingen `length`, så den
læser **nul elementer**, skriver intet — **og kaster ikke**.

Resultatet har den **rigtige længde**, den **rigtige type** og det **forkerte
indhold**. Derfor så alt korrekt ud hele vejen op: rækkerne fandtes, dækningen
sagde 100 %, og `cosine` svarede pænt `null` — hvilket kaldestedet ikke kan
skelne fra «ingen lighed».

Filens egen kommentar, én funktion længere nede, advarer ordret mod netop den
sammenblanding:

> *«0 er en GYLDIG lighed. Bruges 0 også som «kunne ikke beregnes», bliver et
> manglende svar til et dårligt svar.»*

Advarslen var rigtig og stod det forkerte sted: fejlen kom ikke fra at
forveksle 0 med null, men fra at ingen spurgte hvorfor null var svaret **hver
eneste gang**.

## Rettelsen

Begge former håndteres eksplicit. Et BLOB kan lovligt ankomme som begge
afhængigt af driver og transport (lokal fil vs. sqld over HTTP), så det er
ikke en lappeløsning for én driver.

## Hvorfor den eksisterende dækning ikke kunne fange det

Prøverne brugte `Uint8Array` — **præcis den halvdel der aldrig var i stykker.**

**Mutations-bevist:** sættes den gamle afkodning tilbage, går de tre
ArrayBuffer-prøver røde mens de to Uint8Array-prøver bliver **grønne**. Det er
beviset for at den gamle dækning var struktureret så den ikke kunne se fejlen —
ikke at nogen havde glemt en test.

To af de fem nye prøver er de bærende:

- **En afkodet vektor må ikke være lutter nuller.** Den ægte fejl havde rigtig
  længde og rigtig type, så et længde-tjek var grønt gennem hele fejlen.
- **En ÆGTE nul-vektor skal STADIG give `null`.** Rettelsen må ikke gøre
  «kunne ikke beregnes» til et tal.

## Fejlformen, som er dagens gennemgående

En operation der **ikke gør noget og ikke fejler**, og hvis resultat har den
rigtige form. Samme familie som resten af 6. september:

| | |
|---|---|
| `copy.set(arrayBuffer)` | skriver intet, kaster ikke |
| en catch om et kald der starter baggrundsarbejde | dækker ikke arbejdet |
| min frist-prøve | bestod på 257 ms uden at nå fristen |
| min parser af søgesvaret | læste 0 træf fordi feltet hed noget andet |

## Non-goals

- Rører ikke embedding-modellen eller det der SKRIVES. Skrivningen var korrekt.
- Genindekserer ikke: de gemte bytes er rigtige og har været det hele tiden.
  Kun læsningen var gal, så rettelsen alene gør de 1.205 vektorer brugbare.
