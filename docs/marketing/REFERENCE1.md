# Trail — AI memory & second-brain platform

**Trail** er en AI-native videnplatform jeg har designet og bygget i 2026 — en moderne re-tænkning af Niklas Luhmanns Zettelkasten gennem et LLM-objektiv. Platformen er en kombination af **knowledgebase**, **second-brain** og **AI memory** der gør rodede kilder til en levende, søgbar, chat-bar viden-organisme. 

## Hvad Trail er

Hver bruger eller virksomhed har sin egen Trail — en **second-brain** der vokser når den fodres med materiale: PDF'er,
Word-dokumenter, markdown-noter, browser web-clips, billeder, lydoptagelser. Trail kompilerer kilderne til et netværk af **Neurons** — fokuserede, krydsrefererede markdown-dokumenter med typede relationer (`cites`, `contradicts`, `supersedes`, `part-of`, `caused-by`). Det er ikke RAG-over-chunks; det er **compile-time knowledge** med stabile identifikatorer på hver påstand, så cross-Neuron-citationer overlever editering og re-ingest.

Resultatet er en **AI memory** der husker præcist hvad du har lært den, og som kan svare på dansk (eller engelsk, tysk, svensk, norsk) med fuld grounding i din egen viden — uden hallucination og med citationer.

## Kerne-funktionaliteter

- **Neuron-compiler** — automatisk distillering af kilder til strukturerede markdown-Neurons med typed edges
- **Curator-laget** — auto-approval policy engine + diff-UI så du kan godkende, redigere eller afvise hvad LLM'en foreslår før det lander i din knowledgebase
- **Lint-pass** — fanger orphans, gamle Neurons, brudte links og selvmodsigelser. Din second-brain holder sig konsistent og frisk over tid
- **Chat med din Trail** — grounded chat-svar med citationer; **`Din tanke`** Luhmann-friction-noter pr. Neuron som curator selv kan opt-in dele med chat og eksterne integrationer 
- **Web Clipper browser-extension** — clip artikler direkte fra browseren til din Trail
- **Activity log** — fuld audit-timeline af hvad der er sket i din knowledgebase
- **Pluggable LLM-backends** — Claude, OpenRouter, Anthropic API med automatisk fallback-chain
- **Multi-tenant SaaS** — én engine-fleet, en knowledgebase pr. kunde med isoleret AI memory
- **Eksterne integrationer** — embeddable chat-widget, REST API, MCP-server så ethvert site eller LLM-orchestrator kan grunde sit svar i kundens Trail

## Hvad Trail kan bruges til

- **AI memory layer for agentic coding** — Claude Code, Codex, Cursor og andre AI-agenter kan tappe ind i Trail som   persistent second-brain via MCP. Hver session gemmer beslutninger, ADRs og caught-bugs som Neurons, og næste session   henter dem pre-task som kontekst — ingen mere "kontekst forsvandt mellem compacts" eller "vi har løst det her bug før,   men hvor?". Trail bliver et delt korttidshukommelse-til-langtidshukommelse-bro for hele agent-flåden, søgbart pr.   KB-prefix og deduperet via `kbPrefix_XXXXXXXX` seqIDs.
- **Sundhedsprofessionelle og terapeuter** — gør lærebøger, protokoller og kurser til en chat-bar viden-base klienterne kan stille spørgsmål til
  - **Forskere og forfattere** — destillér papers, noter og udkast til et tværrefereret koncept-net der vokser konsistent over tid
  - **Konsulenter og bureauer** — byg en brand-bevidst AI-assistent funderet i firmaets faktiske viden, ikke generisk LLM-output
- **Mindre virksomheder** — erstat "hvor er det dokument?"-Slack-tråde med en søgbar Trail der ikke går stale
- **Forfattere og tænkere** — Luhmann-style second-brain med digital-vækst-egenskaber: jo mere du fodrer, jo skarpere bliver associationerne
- **Customer-facing chat** — embed et chat-widget på dit site der svarer i din tone, med citationer til din egen viden, uden at hallucinere

## Stack & arkitektur

TypeScript monorepo (pnpm + Turbo), libSQL embedded per-tenant med FTS5 fuldtekstsøgning, Fly.io edge-fleet i
Stockholm-regionen. Pluggable LLM-backends med automatisk fallback-chain (Claude CLI → Gemini Flash → GLM → Sonnet
API). Kontinuerlig R2-backup med 30-dages retention, F168 tenant-migration mellem engines, F22 stable claim-anchors for cross-Neuron-citationer, F112 Luhmann-friction-noter, F151 cost+quality dashboard. **200+ commits i 2026**, live på
`app.trailmem.com`, flere kunder i drift.
