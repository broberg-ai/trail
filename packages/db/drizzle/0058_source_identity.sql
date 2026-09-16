-- F275.1 — EN KILDE FÅR EN IDENTITET, og Neuronen får at vide hvilken.
--
-- Christians regel: «hvis kilden — altså en URL på en hjemmeside — forbliver
-- den samme, så skal den seneste udgave være kanon.» Det kræver at vi kan sige
-- HVILKEN kilde to udgaver er udgaver AF.
--
-- MÅLT 16/9 på produktionen, og det er hele grunden til at BEGGE kolonner er her:
--
--   kilden     metadata: {"connector":"broberg-ai-site-sync",
--                         "sourceUrl":"https://broberg.ai/flagskibe/bid"}
--   NEURONEN   metadata: None      ingestJobId: None
--
-- Kilden kendte sin identitet. Neuronen kendte ikke sin kilde. Det eneste spor
-- var linjen `sources: ["flagskibe_bid.md"]` i frontmatter — et filnavn i PROSA.
-- To sites kan begge levere index.md, og prosa kan ikke håndhæves.
--
-- FORMEN ER PRÆFIKSET, med vilje:
--   url:https://broberg.ai/flagskibe/bid     en hjemmeside-kilde
--   path:/Users/…/memory/foo.md              en fil med en stabil sti (F277)
--   fp:<fingeraftryk>                        en uploadet fil (F275.6)
--
-- Præfikset gør det umuligt at forveksle to identitets-RUM. Uden det ville en
-- sti og en URL kunne kollidere, og kollisionen ville se ud som «samme kilde».
--
-- ADDITIV. NULL = «vi ved ikke hvilken kilde» — ikke «ingen kilde». De to må
-- aldrig forveksles, og derfor fyrer afløsnings-reglen kun når feltet ER sat.
ALTER TABLE documents ADD COLUMN source_identity TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_source_identity
  ON documents(tenant_id, source_identity);
