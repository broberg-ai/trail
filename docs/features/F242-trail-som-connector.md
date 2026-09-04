# F242 — Trail som connector: spørg din egen Trail inde fra Claude

**Kort:** trail-F242 · epic · medium
**Skrevet:** 4. september 2026, efter ejerens spørgsmål «har vi ikke lavet en trail mcp server?»

## Målt først — hvad findes der i dag

| | |
|---|---|
| `apps/mcp/` | findes, men er **stdio + lokal disk**: `createLibsqlDatabase({ path: DEFAULT_DB_PATH })`, ingen URL og intet netværkskald i filen |
| Motoren | **ingen `/mcp`-rute**, ingen `@modelcontextprotocol`-afhængighed |
| Skyen, live-testet | `POST app.trailmem.com/mcp` → **404** · `POST engine-001.trailmem.com/mcp` → **404** |
| Det der faktisk virker | buddys MCP (`mcp__buddy__trail_search` / `trail_save`), som kalder Trails HTTP-API |

**Fælden ved `apps/mcp/`:** peget mod en udviklermaskine svarer den selvsikkert med den FORKERTE Trails indhold. Den fejler ikke — den svarer bare forkert.

**Begrænsningen i buddys:** den er bundet til ÉN knowledge base af en env-variabel — `mcp-server.ts:953` læser `TRAIL_BUDDY_SESSIONS_KB_ID` — og sender ingen tenant-header. Ingen session kan altså spørge Sannes Trail eller vælge en anden Trail. Det er korrekt for det den er bygget til, og utilstrækkeligt som produktflade.

## Hvorfor — og det er én grund, ikke en liste

**Trail er værdifuld i det øjeblik nogen skal FINDE noget. Det øjeblik sker i stigende grad inde i assistenten, ikke i en browserfane.**

Ejeren har allerede fem connectors monteret i Claude — Apple Music, DNS Manager, Gmail, Google Calendar, GitHub. Trail, som er hans egen hukommelse, er den der mangler. I dag skal han forlade den samtale han er i, åbne app.trailmem.com, finde den rigtige Trail og søge. Det er nok friktion til at man lader være, og en videnbase man ikke slår op i er ingen videnbase.

Det samme gælder en kunde. Sanne skal kunne montere SIN Trail og spørge om sit eget materiale dér hvor hun i forvejen skriver.

**Det er altså en produktflade, ikke intern værktøjshygiejne.** Det er testen kortet skal bestå, og grunden til at det ikke bare er «giv de andre sessions bedre adgang» — det er en præmie, ikke formålet.

## Scope

**I scope:**
- En MCP-indgang på motoren over HTTP, autentificeret med en almindelig `trail_`-nøgle.
- Tenant og Trail vælges **eksplicit** ved forbindelsen — aldrig gættet, aldrig et hjemme-fallback.
- **Læsning først:** søg, hent en Neuron, spørg over en Trail.

**Non-goals, og de er bevidste:**
- **Skrivning kommer ikke i første omgang.** Når den kommer, går den gennem kandidat-køen som alt andet — en MCP må ikke få en genvej udenom det review ejeren laver.
- **`apps/mcp/` røres ikke** her. Om den skal beholdes som lokalt udviklerværktøj eller pensioneres er sin egen beslutning; at rette to ting på én gang er hvordan man får to fejl.
- **buddys MCP røres ikke.** Den virker til det den gør.

## De tre ting der skal besluttes rigtigt

| spørgsmål | hvorfor det er svært |
|---|---|
| **Hvordan logger man på?** | Claude Desktop-connectors bruger typisk OAuth 2.1. Flotten har præcedens: Apple Music-MCP'en kører OAuth 2.1 + SSE. Trail har allerede `trail_`-nøgler, så en bearer er den korte vej — men den længere kan være den rigtige for en kunde. |
| **Hvilken Trail spørger man?** | En nøgle med `scope=all` spænder over flere tenants og vælger i dag via `X-Trail-Tenant`. En MCP-forbindelse har ikke en header pr. kald på samme måde — valget skal bindes ved forbindelsen, og **et stille fallback til hjemme-tenanten er den fejl der skal designes væk.** Det er præcis den fælde buddys egen MCP har i dag. |
| **Hvad må en connector se?** | Trail har allerede et publikum-begreb (`audience`) der skjuler interne Neuroner for værktøjs-kald. Den skal gælde her også, ellers er en connector en omvej udenom den. |

## RÆKKEFØLGE — dette skal IKKE bygges før F222

**Ikke af forsigtighed, men fordi 4. september viste hvorfor.** Motoren kørte på den mindste maskine Fly sælger med **33 MB ledig hukommelse og en belastning på 4,36 på én delt kerne**. Enhver ekstra byrde gjorde hele admin ubrugelig — ikke bare den funktion der blev tilføjet.

En MCP-indgang er en **ny offentlig flade med ukendt trafik** oven på den maskine. At åbne den før [F222](F222-machines-must-be-replaceable.md) har flyttet tilstanden af maskinerne, er at gentage dagens fejl med større indsats.

Maskinen er siden opgraderet til 2 kerner og 4 GB, hvilket køber luft — det løser ikke at al tilstand stadig ligger på én kasse.

## Reuse

Discovery-tjek 4. september: der er **ingen `@broberg/*`-pakke til MCP-servere**. `@broberg/apikey` dækker indgående nøgler og er relevant for autentificeringen; resten er `@modelcontextprotocol/sdk` direkte, som er husets normale stak (Apple Music MCP, DNS Manager, cardmem og buddy kører alle på den). Bliver godkendelses-delen værd at dele, hører den hjemme hos `components` — ikke som en kopi her.

## Åbne spørgsmål til ejeren

1. **Er målgruppen dig, eller også kunderne?** Kun dig → en bearer-nøgle er nok. Også kunder → OAuth, og så er kortet større.
2. **Skal en connector kunne SKRIVE til Trail senere**, eller er læsning hele formålet? Svaret ændrer designet af tenant-bindingen.
