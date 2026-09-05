# F248 — hele admin er mobil-klar: samtlige ruter uden wiggle

**Kort:** trail-F248 · epic · critical · ejerens ordre 5/9 2026 (tre telefonskud)

> «Alt i app skal kunne vises optimalt på en mobiltelefon så du kan lige så
> godt gå igennem samtlige sider og routes … så der ikke er noget wiggle.»

## Motivation + målte fund

Ejeren bruger Trail fra iPhonen (PWA'en fra F247 gør det til daglig vane).
Tre skud på én formiddag: topbjælke-wiggle (fixet, F246), 404 på bar
trail-adresse efter login, og desktop-tokolonne-layout på telefonen
(sidebar 240px af 393px — indhold klippet).

## Historier

1. **F248.1 — bar trail-adresse lander på Chat.** `/kb/:kbId` havde ingen
   rute → NotFound. Ny redirect-rute → `/kb/:kbId/chat` (første punkt i
   sidebarens BRUG-gruppe = det naturlige landingssted).
2. **F248.2 — sidebaren som ikon-skinne på mobil.** Collapse-mekanismen
   FINDES (60px-skinne); på ≤700px er skinnen udgangspunktet (matchMedia ved
   init; desktop-valget i localStorage vinder kun på store skærme).
3. **F248.3 — fejningen: ALLE ruter ved 393px.** Rute-listen læses fra
   main.tsx (24 ruter), hver måles med kant-asserten mod PROD (fd-aalborg
   admin-chat som datagrundlag), hver synder fixes (bredt indhold i egen
   overflow-x:auto-beholder — aldrig på body), og facit er en tabel:
   rute · scrollWidth-før · grøn-efter. Kritikeren kører med som signal.

## Metode (global beslutning 01a06b42)

Eget JS-assert er beviset (højre kant vs innerWidth + scrollWidth — navngiver
synderne); kritikerens grønne står aldrig alene. Lens på prod med mint-auth.

## Non-goals

- Ingen redesign af paneler (kun at de KAN vises — layoutfejl, ikke æstetik)
- Graf-panelet må gerne være «bedst på desktop», men må ikke wiggle siden
- Onboarding/Ingest Station/landing er egne apps — ikke i denne epic

## Reuse

Ingen ny kapabilitet: Lens (flådens) + F246's CSS-mønster (klasser + én
medieforespørgsel). Discovery-tjek unødigt (ingen provider).
