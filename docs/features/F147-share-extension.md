# F147 — Share Extension (iOS + Android)

> Native share targets for iOS og Android der lader brugeren sende tekst, links og billeder direkte fra andre apps til Trail — uden at forlade kilden.

## Problem

Trail's primære input-kanaler i dag er: upload-dropzone i admin, web clipper (browser), og MCP/CLI. Men den mest naturlige input-sti på mobile enheder er **share sheet** — den system-level "Del"-knap der findes i Fotos, Safari, Instagram, Notes, Spotify, og stort set alle andre apps.

Uden en share extension er den mobile workflow:
1. Se noget interessant i en app (f.eks. et Instagram-billede eller en artikel i Safari)
2. Åbn Trail i browseren
3. Log ind
4. Find KB
5. Upload/clip manuelt

Det er for meget friktion til at blive en vane. Karpathy's Obsidian Web Clipper virker fordi det er ét klik fra browseren. På mobil er share sheet det tilsvarende "one-tap" mønster.

## Solution

Tre komponenter:

1. **iOS Share Extension** (Swift/SwiftUI) — dukker op i iOS share sheet som "Trail Clipper". Modtager tekst, URLs, billeder og billeder+tekst kombinationer. Upload til Trail via API.

2. **Android Share Extension** (Kotlin/Jetpack Compose) — tilsvarende share target på Android.

3. **Server-side vision pipeline** — billeder uploades via share extension og sendes gennem Anthropic Vision for beskrivelse + OCR. Den genererede markdown + billedbeskrivelse lander som source i Trail.

### iOS Share Extension Arkitektur

**Flow:**
1. Brugeren trykker "Del" i Fotos/Safari/Instagram/etc.
2. "Trail Clipper" vises i share sheet (hvis installeret)
3. Extension åbner med preview af indholdet (tekst, billede thumbnail, URL)
4. Bruger vælger KB (cached fra sidste gang) + tilføjer tags
5. Trykker "Clip" → POST til Trail API
6. Bekræftelse → extension lukker

**Auth:** Deler `serverUrl` og `token` med hoved-appen via **App Group** (`group.com.broberg.trail`). Brugeren logger ind i hoved-appen én gang, og extensionen får adgang til credentials.

**Input-typer der understøttes:**
- `public.url` — links fra Safari, Instagram, Twitter, etc.
- `public.text` — tekst fra Notes, Messages, etc.
- `public.image` — billeder fra Fotos, kamera, screenshots
- `public.url` + `public.text` — URL med preview-tekst (Safari reader mode)

### Server-side Vision Pipeline

Når et billede uploades via share extension:

1. Extension sender billedet som multipart upload til `/api/v1/knowledge-bases/:kbId/documents/upload`
2. Serveren genkender billedtypen → sender til vision backend (allerede eksisterende: `apps/server/src/services/vision.ts`)
3. Vision AI returnerer beskrivelse + OCR-tekst
4. Markdown source oprettes med: frontmatter (title, source, clippedAt, tags) + vision-beskrivelse + OCR-tekst
5. Ingest trigger automatisk

**Cost:** ~$0.02-0.05 per billede med Anthropic Sonnet 3.5. Ved 50 billeder/dag = $1-2.50/måned.

### Android Share Extension

Tilsvarende arkitektur med Kotlin.

## Technical Design

### API: Upload med billed-metadata

Den eksisterende upload-endpoint (`POST /api/v1/knowledge-bases/:kbId/documents/upload`) understøtter allerede `metadata` feltet. Share extension sender:

```json
{
  "connector": "share-extension",
  "sourceUrl": "https://www.instagram.com/p/ABC123/",
  "clippedAt": "2026-04-22T18:00:00Z",
  "tags": ["instagram", "screenshot"],
  "platform": "ios",
  "sourceApp": "Photos"
}
```

### Vision Pipeline Integration

Den eksisterende vision backend (`apps/server/src/services/vision.ts`) kan genbruges direkte. Billeder fra share extension uploades som normale billed-kilder og trigger den samme pipeline som PDF-billeder.

**Fix nødvendig:** Tilføj `processImageAsync` i upload-routen der:
1. Sender billedet til vision backend
2. Gemmer beskrivelsen som `content` på document-rækken
3. Trigger ingest

### Connector

Tilføj `share-extension` til `packages/shared/src/connectors.ts`.

## Effort Estimate

**Large** — 5-7 dage

- Server-side billed-upload med vision: 1 dag
- iOS share extension: 2-3 dage (Swift, App Group, UI, upload)
- Android share extension: 2 dage (Kotlin, UI, upload)
- Test + polish: 1 dag