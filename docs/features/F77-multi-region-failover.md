# F77 — Multi-Region Deployments & Regional Failover

> Geografisk redundans for Business+-tenants: read-replicas + geo-DNS for sub-100ms læsninger i fjerne regioner, OG regional failover så en Fly-region-outage ikke tager en betalende kunde ned. **Tier: Phase 3+ · Business+ opt-in · Effort: Large · Status: Planned.**

## Status & historik

Tidligere kun en stub: en række i `FEATURES.md` (#f77-multi-region — "Read replicas + geo-DNS"), en linje i `ROADMAP.md` (Should), og krydsreferencer fra F40/F86/F154/F155/F169/F170 + `SAAS-SCALING-PLAN.md`/`DEPLOYMENT-STAGES.md`. Ræsonnementet bag var aldrig skrevet ned — dette dokument fylder den ud (2026-06-04). F-nummeret er **ikke** nyt; det er allerede allokeret.

## Problem / motivation

To behov, samme infrastruktur-svar:

1. **Latency for globale kunder.** Default-regionen er `arn` (Stockholm). En Business+-kunde med brugere i fx US eller APAC får 150-300 ms ekstra på hver læsning. `SAAS-SCALING-PLAN.md` udpeger read-replicas i sekundære regioner (Turso embedded-replica-feature) som det enkleste svar — *"Evaluate when F77 actually has customers driving it."*

2. **Availability / failover.** I dag kører motor + admin på **én Fly-maskine pr. tenant-gruppe** (databasen ligger på maskinens eget volume — den låste Fase 1-arkitektur). Det betyder: en region-outage, en maskine-genstart eller et deploy = et vindue uden failover hvor Fly's edge svarer 503 til alle. `DEPLOYMENT-STAGES.md` slår eksplicit fast at dette er et **bevidst accepteret tradeoff for små tiers** ("Fly-region outage → F77 regional failover (Business+), Hobby/Starter accepterer downtime"). F77 er hjemmet for den failover-garanti, når en betalende Business+-kunde driver behovet.

**Hvorfor ikke nu:** På nuværende stadie (Stage 1 — Sanne-dogfood + broberg-ai, 1-2 tenants) er single-region/single-maskine det rigtige. Deploy-vinduets korte 503'er absorberes på klientsiden (admin `api()` retry, 2026-06-04). F77 åbnes først når der er en kunde hvis SLA eller geografi retfærdiggør de ekstra ops- og cost-omkostninger — typisk M12-M18 efter første Business+/Enterprise-kontrakt (`DEPLOYMENT-STAGES.md`).

## Scope

**In:**
- Read-replica af en tenants libSQL-database i ≥1 sekundær region (mekanisme: Turso Cloud embedded-replicas, libSQL-native — eller selvhostet libSQL-replikering på Fly-volumes; afgøres i spike, se åbne spørgsmål).
- Geo-DNS-routing (Fly Anycast / Cloudflare): læse-trafik dirigeres til nærmeste sunde region; skrivninger proxyes altid til primær-regionen (single-writer bevares).
- Regional failover: health-probe på primær-region; ved outage shedder geo-DNS til sekundær region for Business+-tenants (read-only-degradering, evt. promote af replica iht. SLA).
- Per-tenant opt-in via control-plane-config; **kun Business+-tier**.
- Integration med **F86 SLA Monitoring**: failover-events + status-side.
- Bygger på **F154** (control plane sætter tenant-region-sæt), **F155** (regional auto-placement, Phase 3+) og **F170** (multi-engine orchestrator flytter/replikerer tenants).

**Non-goals (eksplicit):**
- **Ikke default for Hobby/Starter/Pro.** Single-region `arn` forbliver default; de tiers accepterer kort downtime ved deploy/outage (`DEPLOYMENT-STAGES.md`). At ændre det ville sprænge cost-modellen.
- **Ikke en central DB / Postgres-migration.** Den låste arkitektur er embedded libSQL pr. tenant — centralt Postgres/D1/Turso-Cloud som primær query-path er afvist. F77 bliver på libSQL via **embedded replicas**, ikke en central DB-host. (Central Postgres som enterprise-compliance-option er F84's område, ikke F77's.)
- **Ikke zero-downtime deploy for single-region-motoren.** At eliminere selve deploy-vinduet hører til **F170 Fase 3** (shadow-write/dual-read). F77 handler om *geografisk* redundans, ikke om at fjerne deploy-vinduet for en single-region tenant.
- **Ikke write-scaling / multi-master.** Single-writer pr. tenant-DB bevares; replicas er read-only. Ingen distribueret konsensus.
- **Ikke cross-region tenant-migration-automation.** Det ejes af F168/F170. F77 ejer geografisk replikering, ikke flytning.

## Arkitektur-skitse

```
                 ┌──────────── geo-DNS (Anycast / Cloudflare) ────────────┐
                 │ writes → primær · reads → nærmeste sunde region          │
                 ▼                                                          ▼
   ┌─────────────────────────────┐                       ┌─────────────────────────────┐
   │  PRIMÆR region (arn)         │   embedded-replica    │  SEKUNDÆR region (fx iad)    │
   │  trail-engine (writer)       │ ────── sync ─────────▶│  trail-engine-replica (RO)   │
   │  libSQL på volume (kilde)    │                       │  libSQL embedded replica     │
   └─────────────────────────────┘                       └─────────────────────────────┘
        ▲ health-probe (F86)                                   ▲ overtager reads ved
        └──── outage → geo-DNS sheds til sekundær ─────────────┘ primær-outage (Business+)
```

- **Writer** forbliver embedded libSQL på tenantens hjem-region-volume (`arn`). Ingen ændring af den låste query-path for skrivninger.
- **Sekundære regioner** kører read-replica-motorer der synker fra primær via libSQL embedded-replica-protokollen.
- **Failover** for Business+: ved primær-outage serverer sekundær region read-only (eller promoveres iht. SLA-niveau).
- **Region-policy:** sekundære regioner for EU-default-tenants skal blive i EU (GDPR/data-residency) medmindre kunden eksplicit opt-in'er global distribution.

## Afhængigheder

| F-nr | Relation |
|---|---|
| F40 Multi-tenancy | `@trail/db` per-tenant libSQL — fundament |
| F42 Pluggable storage | Tigris/R2-adaptere; blob skal også være region-tilgængelig |
| F154 Control Plane | Sætter per-tenant region-sæt; UI til failover-status |
| F155 Auto-scaling Policy | Regional auto-placement (eksplicit Phase 3+ i F155-planen) |
| F170 Multi-engine orchestrator | Replikerer/flytter tenants mellem motorer |
| F84 Dedicated PostgreSQL | Alternativ DB-path for enterprise-compliance (ikke F77's default) |
| F86 SLA Monitoring | Forbruger af failover-events; public status-side |
| Turso Cloud | Embedded-replica-capability (evalueres som mekanisme) |

## Rollout / trigger-gate

Åbnes **ikke** før et af disse lander (per `SAAS-SCALING-PLAN.md` + `DEPLOYMENT-STAGES.md`):
1. En Business+-kunde med en bruger-base i en fjern region (latency driver), eller
2. En kontrakt med uptime-SLA (failover driver — kobler til F86).

Faset levering når gaten er åben:
1. **Spike:** Turso embedded-replicas vs. selvhostet libSQL-replikering på Fly-volumes — cost, ops, data-residency. Beslut mekanisme.
2. Read-replica i én sekundær region for én pilot-Business+-tenant (kun læsning).
3. Geo-DNS read-routing til nærmeste sunde region.
4. Regional failover + F86 SLA-integration (health-probe → geo-DNS shed → status-side).
5. F155 regional auto-placement ved signup for Business+.

## Åbne spørgsmål

- **Replica-mekanisme:** Turso Cloud embedded-replicas (managed, men ekstern afhængighed + cost) vs. selvhostet libSQL-replikering på Fly-volumes (mere ops, fuld kontrol). Spike afgør.
- **Write-under-failover-semantik:** read-only-degradering (sikkert, men kunden kan ikke skrive under outage) vs. promote-secondary-to-writer (fuld funktion, men split-brain-risiko ved netværks-partition). Sandsynligvis read-only for v1.
- **Data-residency:** hvilke sekundære regioner er tilladt for EU-default-tenants uden eksplicit kunde-samtykke? (Region-policy: `arn` default; global = Business+ opt-in.)
