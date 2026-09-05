# F247 — Trail admin som PWA: installérbar på telefonen

**Kort:** trail-F247 · epic · high · ejerens ordre 5/9 2026

> «når du er færdig med migrationen går du i gang med at lave app til en PWA.
> Der er hjælp at hente hos Cardmem og resten af flåden og Discovery.»

## Motivation

Ejeren bruger Trail fra telefonen (dagens F246-melding kom fra et telefonskud).
En PWA gør app.trailmem.com til et ikon på hjemmeskærmen med fuldskærm,
hurtig opstart og (fase 2) push når der sker noget i køen — uden App Store.

## Reuse (F217 — målt på Discovery 5/9)

- **@broberg/pwa v0.3.0** (components F054, shipped): `createPwaUpdater()` —
  hele service-worker-opdaterings-livscyklussen (registrering, «ny version»-
  signal, skipWaiting/reload). Bygget fordi fds, cardmem og pitch-vault hver
  håndrullede en kopi — vi bliver konsument #4, ALDRIG kopi #5.
- **@broberg/webpush v0.5.0** (components F067, shipped): push-abonnement +
  udsendelse inkl. sendSilent(). Fase 2.
- **Levende referencer:** cardmem + fds kører begge PWA i produktion — spørg
  dem via intercom ved tvivl om iOS-egenheder (splash, statusbar, safe-area).

## Arkitektur-skitse

Alt i `apps/admin/` (Vite + Preact):

1. **Manifest + ikoner** (F247.1): `manifest.webmanifest` (navn, farver,
   display: standalone, start_url «/»), ikon-sæt (192/512 + maskable + Apple
   touch), iOS-meta (apple-mobile-web-app-*). Ikonet tegnes fra TrailLogo
   (cirklerne) på accent-baggrund.
2. **Service worker + update-flow** (F247.2): minimal SW — precache af
   app-skallen (hashede assets), network-first på navigation (aldrig stale
   index.html), runtime-cache KUN på statiske assets. `createPwaUpdater()`
   driver «Ny version — opdatér»-toasten (custom komponent, testid).
   API-kald caches IKKE (kundedata hører ikke i en browser-cache).
3. **Push** (F247.3, fase 2, kræver ejer-GO for omfang): @broberg/webpush —
   abonnement fra Settings, server-udsendelse ved fx nye kø-kandidater.

## Non-goals

- Ingen offline-DATA (chat/søgning kræver motoren; offline viser en ærlig
  «du er offline»-tilstand i app-skallen).
- Ingen App Store/TWA-indpakning.
- Ingest Station/onboarding/landing får IKKE PWA i denne epic — kun admin.

## Rollout

F247.1 → F247.2 shippes sammen eller tæt (manifest uden SW er halvt
installérbar); Lens-bevis ved 393px pr. flade; F247.3 venter på ejerens GO.
Risikoen at værne: en SW der cacher for aggressivt kan servere en død app —
derfor network-first på navigation + @broberg/pwa-flowet + en kill-switch
(SW afregistrerer sig hvis /api/health svarer med et særligt flag).
