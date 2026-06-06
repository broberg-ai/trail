# F192 — Ingest-kø-panel (samlet kø/færdig/fejlet-visning)

> **Status:** Planned · **Kind:** epic · **Owner:** trail · **Created:** 2026-06-06
>
> Stories: F192.1 (API-shape) · F192.2 (UI-panel) · F192.3 (live SSE) · F192.4 (local-paritet + retry)

## Motivation

Den 2026-06-06 droppede Christian fire Sanne-kompendier (`Hormonsystemet Next Level 2024`, `Zoneterapi_Vibration_Nervesystemet_2024`, `1. Hæv din vibration - slideshow`, `Ansigtszoneterapi_Kompendium_2025`) i sanne-andersen-KB'en og havde **nul indblik** i hvilke der var compilerede og hvilke der stadig stod i kø til local-ingest. Han måtte spørge cc-sessionen, der så hentede status via rå `GET /api/v1/documents`-kald.

Det centrale: **status-dataen findes allerede**. Hvert dokument bærer felterne `awaitingLocalCompile` (= i kø), `status`, `neuronCount` (= hvor mange Neuroner kilden blev til) og `errorMessage`. Kø/færdig/fejlet-visningen er derfor **ren UI** — den har intet med model, API-backend eller Max-plan vs. betalt at gøre. Christians pointe (verbatim): *"jeg forstår ikke hvorfor dette ikke har kunnet blive genbrugt da det IKKE har noget med model og API/Max plan at gøre."* Han har ret.

I dag viser cloud-admin'ens Ingest Station en **banner pr. kilde** (F191.8: `source_compiled`-SSE rydder banneret), men der er ingen samlet liste der svarer på "hvad er i kø / hvad er færdigt / hvad fejlede" på tværs af både cloud-compilerede og local-ingest-compilerede kilder. Denne epic lukker det hul.

## Scope

### In
- **Samlet ingest-status-visning** i admin: alle kilder i en KB grupperet i tre tilstande — ⏳ **i kø** (`awaitingLocalCompile=true` eller cloud-compile in-flight), ✓ **færdig** (med `neuronCount`), ✖ **fejlet** (med `errorMessage`).
- **Datadrevet af den eksisterende dokument-flade** (`GET /api/v1/knowledge-bases/:kb/documents`) — én kilde til sandhed for begge compile-veje.
- **Live-opdatering** via engine-SSE: genbrug `source_compiled`; tilføj `source_queued` + `source_failed` så panelet afspejler ALLE overgange uden refresh.
- **Paritet** mellem cloud- og local-ingest: en local-ingest-ryddet kilde (`POST /documents/:id/local-compiled`) skal vises identisk med en cloud-compileret (status=done + neuronCount sat).
- **Lens-klar** (data-testid efter `<side>-<element>`-konvention), **custom-komponenter** (ingen `<select>`/native), **knap-feedback** (loading >100ms, bekræftelse, fejl).

### Non-goals
- **Ingen ændring af compile-motorerne** (hverken cloud OpenRouter eller local $0-session). Dette er ren synlighed.
- **Ingen ændring af model-/backend-valg** eller cost-beregning (per-tenant cost = upmetrics' domæne).
- **Ikke en omskrivning af drop-zonen** i Ingest Station — den genbruges som den er.
- **Ingen ny auth/tenant-logik** — bruger den eksisterende scope/`X-Trail-Tenant`-flade.

## Arkitektur-skitse

**Data (F192.1).** `GET /api/v1/knowledge-bases/:kb/documents` returnerer allerede `awaitingLocalCompile`, `status`, `failed`, `neuronCount`, `errorMessage`, `pageCount`, `fileType`, `createdAt`. Vi udleder en eksplicit `ingestState`-enum — `queued | processing | done | failed` — så klienten ikke re-deriver tilstanden ad-hoc fem steder. Beregning: `failed` → failed; `awaitingLocalCompile` → queued; cloud-compile in-flight (`status`-felt) → processing; ellers → done. Evt. en slank `?view=ingest-status`-projektion der kun returnerer det panelet skal bruge (id, filename, fileType, ingestState, neuronCount, pageCount, errorMessage, updatedAt).

**UI (F192.2).** Nyt panel/sektion i den eksisterende Ingest Station under `apps/admin`. Grupperet tabel (kø / færdig / fejlet) med kolonner: fil, type, sider, neuron-tæller, tidspunkt, status-badge. Genbrug eksisterende tabel-/liste-primitiver. `data-testid="ingest-queue-root"` + per-gruppe/per-række testids. Tom-tilstand når KB'en er helt drænet.

**Live (F192.3).** Abonnér på engine-SSE. `source_compiled` findes (F191.8). Tilføj `source_queued` (når en kilde parkeres med `awaitingLocalCompile=true` ved drop) og `source_failed` (ved compile-fejl / `local-compiled {failed:true}`). Panelet flytter rækker mellem grupper live; backfill via et almindeligt fetch ved mount + reconnect.

**Local-paritet (F192.4).** Verificér at `POST /documents/:id/local-compiled` sætter de felter panelet læser (`status=done`, `neuronCount` populeret, `awaitingLocalCompile=false`) — og at `{failed:true}` sætter `failed`+`errorMessage`. Tilføj en **retry/re-queue**-affordance på fejlede kilder (knap der sætter `awaitingLocalCompile=true` igen → re-dispatch). Knappen følger CLAUDE.md's feedback-krav.

## Afhængigheder
- **F191** (local-ingest): `awaitingLocalCompile`-flag, `/local-compiled`-endpoint, `source_compiled`-SSE.
- Eksisterende **Ingest Station**-UI i `apps/admin` + `apps/admin/src/api.ts`.
- Engine-SSE-kanalen (samme der i dag rydder Ingest Station-banneret).

## Rollout
Ren additiv UI — ingen feature-flag nødvendig. Rækkefølge: **F192.1** (API-shape) → **F192.2** (panel) → **F192.3** (live) → **F192.4** (paritet + retry). Hver story verificeres mod den rigtige sanne-andersen KB (de 4 parkerede kompendier er en levende test-fixture lige nu). Verifikation = scripted probe + Lens-capture, jf. repoets "Verification before this works"-regel — ikke kun typecheck.

## Åbne spørgsmål
- Skal `processing` (cloud-compile in-flight) vises som egen gruppe eller foldes ind i ⏳ kø? Foreslået: egen badge, men samme "ikke-færdig"-gruppe, så curatoren ser ét "venter"-bånd.
- Skal panelet bo som ny fane i Ingest Station eller som et bånd øverst i den eksisterende kilde-liste? Afklares i F192.2 mod det nuværende layout.
