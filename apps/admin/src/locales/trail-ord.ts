/**
 * F271 — hvilke UI-tekster betyder PRODUKTET «Trail», og hvilke betød ENHEDEN.
 *
 * Ordet stod for to ting i samme skærmbillede. Beviset var vores egen tomme
 * tilstand, som var nødt til at DEFINERE ordet: «En trail er én vidensbase inde
 * i denne tenant.» Den sætning findes kun når navnet ikke forklarer sig selv.
 *
 * Enheden hedder nu et **Brain** — ikke et nyt ord, men det ord produktet
 * allerede brugte om sig selv (manifestet: «din second brain») og som API'et
 * allerede bar (`/brain-versions`). Et Brain rummer Neuroner.
 *
 * LISTERNE ER DATA, IKKE ET MØNSTER. Et mønster ville skulle gentage vurderingen
 * hver gang det kørte, og «Sign in to Trail» og «Create Trail» er samme token.
 * Vurderingen er truffet én gang pr. nøgle og kan læses af et menneske.
 *
 * Nøglerne er identiske i en.json og da.json (målt: 71 af 71), så én
 * klassificering dækker begge sprog.
 */

/** Betød enheden. Må IKKE indeholde ordet «trail» længere. */
export const ENHEDS_NOEGLER = [
  'ambient.connect.noKbs', 'ambient.connect.pickKbs', 'chat.emptyHint', 'chat.placeholder',
  'empty.noNeuronsTitle', 'empty.noBrainsCTA', 'empty.noBrainsTitle',
  'graph.emptyBody', 'images.sortScope', 'kbs.create', 'kbs.empty', 'kbs.newBrain.button',
  'kbs.newBrain.descriptionPlaceholder', 'kbs.newBrain.submit', 'kbs.newBrain.title', 'kbs.title',
  'lifecycle.decayActive', 'lifecycle.decayPaused', 'lifecycle.mhSubtitle',
  'linkReport.empty', 'linkReport.subtitle', 'manageTenants.subtitle', 'nav.brains',
  'notFound.backToBrains', 'palette.actionNewBrain', 'palette.groupBrains', 'searchPanel.subtitle',
  'settings.trail.ambientMode.subtitle', 'settings.trail.chatModel.subtitle', 'settings.trail.decay.subtitle',
  'settings.trail.descriptionPlaceholder', 'settings.trail.ingestModel.subtitle', 'settings.trail.languageHint',
  'settings.trail.lintSchedule.hint', 'settings.trail.lintSchedule.subtitle', 'settings.trail.nameHint',
  'settings.trail.personas.subtitle', 'settings.trail.subtitle', 'settings.trail.title',
  'sidebar.back', 'sources.duplicate.body', 'sources.duplicate.title', 'work.subtitle',
] as const;

/**
 * Betyder PRODUKTET. SKAL stadig indeholde ordet «trail».
 *
 * Den halvdel er den bærende. Uden den ville «omdøb alt» bestå prøven, og
 * «Sign in to Brain» ville være grønt.
 */
export const PRODUKT_NOEGLER = [
  'accountPrefs.developer.empty', 'accountPrefs.developer.subtitle', 'ambient.connect.invalidCode',
  'ambient.connect.title', 'connectors.hints.chat', 'connectors.hints.discord', 'connectors.hints.mcp',
  'connectors.hints.mcp:claude-code', 'connectors.hints.mcp:cursor', 'connectors.hints.notion',
  'connectors.hints.slack', 'cost.credits.explanation', 'empty.noNeuronsBody', 'glossary.subtitle',
  'empty.noBrainsBody', 'kbs.totalNeurons', 'lifecycle.introBody', 'lifecycle.mhDecayRatesHint', 'login.title',
  'settings.account.apiKeys.subtitle', 'settings.account.backupHealth.notConfiguredHint',
  'settings.account.backupHealth.subtitle', 'settings.trail.ingestModel.hint',
  'settings.trail.personas.publicHint', 'settings.trail.personas.toolHint',
  'sources.reingestBody', 'sources.reingestHint',
] as const;

/**
 * Bærer BEGGE betydninger i samme sætning — «A Trail Ambient device … into your
 * Brain». Ingen regel kan klare den; den er skrevet i hånden og undtages derfor
 * fra begge påstande ovenfor.
 */
export const BEGGE_NOEGLER = ['ambient.connect.intro'] as const;
