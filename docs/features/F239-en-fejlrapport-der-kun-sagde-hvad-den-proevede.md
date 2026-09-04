# F239 — en fejlrapport der kun sagde hvad den prøvede

**Kort:** trail-F239 · story · medium

## Fundet fordi ejeren spurgte

Efter at motoren var oppe igen stod der i loggen:

```
[activity-log] write failed: Failed query: insert into "activity_log" (...)
params: act_8587cfe1-…, t-broberg-ai, ae9aad44-…, u-cb-webhouse, user, …
```

Seks gange. Ejeren bad mig tage den.

## Beskeden indeholdt ikke fejlen

`logActivity` fanger sine egne fejl med vilje — en aktivitetslinje må aldrig
vælte den handling den beskriver. Men den loggede `err.message`, og **for en
drizzle-fejl ER den besked hele SQL-sætningen plus parametrene.**

Grunden ligger i `err.cause`. Den blev aldrig printet.

**Så rapporten fortalte hvad vi PRØVEDE, og aldrig hvorfor det gik galt.** Det
er samme fejlform som resten af døgnet, nu i selve det instrument der skal
fortælle os om fejl.

## Hvad diagnosen kostede

Fire runder SSH til en kundes produktionsdatabase for at måle:

```
tabellen findes, 11 kolonner       ✓
fremmednøgler peger på ægte rækker ✓
manuel indsættelse, FK slået fra   ok
manuel indsættelse, FK slået til   ok
med de RIGTIGE værdier fra loggen  ok
```

**Hver eneste manuelle gentagelse af nøjagtig samme indsættelse lykkedes.** Og
den nyeste række i tabellen var fra samme sekund som «fejlen» — så nogle
skrivninger lykkedes mens andre fejlede, uden at noget kunne skelne dem.

Det er ikke en svær fejl. Det er en fejl uden en fejlbesked.

## Rettelsen

`err.cause` logges nu, og tenanten står med — ellers kan en fejl ikke henføres
til en kunde.

**Og fallbacken er bevidst:** har fejlen ingen `cause`, bruges beskeden.
«Vi ved ikke hvorfor» og «der stod ingenting» må ikke se ens ud.

## Hvad der IKKE er afgjort

**Selve årsagen står stadig åben.** Alt peger på at de seks fejl faldt i
opstartsvinduet efter en genstart (10:26:20), og at skrivninger siden er landet
normalt — men det er en korrelation, ikke en måling, og jeg skriver den som
det.

Næste gang det sker, står grunden i loggen. Det er dét denne ændring køber:
ikke en forklaring, men muligheden for at få en.
