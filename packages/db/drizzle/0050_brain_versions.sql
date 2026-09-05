-- F253.2 — hjerne-versioner: et MÆRKE, ikke en kopi.
--
-- Kopierne findes allerede. Målt i broberg-ai 6/9 2026: 8.393 hændelser i
-- wiki_events, hver med en fuld content_snapshot, NUL uden. En version behøver
-- derfor kun at pege på et tidspunkt i den log der allerede er der.
--
-- Prisen: én række (nogle hundrede bytes) mod ~18 MB hvis vi kopierede
-- Neuron-indholdet ved hvert mærke.
--
-- high_water_event_id er ikke pynt ved siden af taken_at: basen bærer TO
-- tidsformater side om side ("2026-09-04T19:51:23.528Z" fra drizzles
-- $defaultFn og "2026-09-04 19:49:50" fra SQLites datetime('now')), og to
-- hændelser kan lande i samme sekund. Tid alene er ikke en nøgle.
CREATE TABLE IF NOT EXISTS brain_versions (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  -- 'manual' | 'auto:ingest' | 'auto:lint' | 'auto:bulk-approve' | 'auto:restore'
  reason TEXT NOT NULL DEFAULT 'manual',
  -- Grænsen mærket peger på. Hændelser til og med denne hører til versionen.
  taken_at TEXT NOT NULL,
  high_water_event_id TEXT,
  -- Var hændelses-loggen komplet da mærket blev taget? Et mærke taget over en
  -- log med huller kan ikke gendanne fuldstændigt, og det skal stå PÅ mærket
  -- frem for at blive opdaget af en gendannelse tre måneder senere.
  coverage_intact INTEGER NOT NULL DEFAULT 1,
  coverage_gaps INTEGER NOT NULL DEFAULT 0,
  -- Hvor mange aktive Neuroner der fandtes da mærket blev taget. Bruges som
  -- fornufts-tjek i forskellen, ikke som sandhed.
  neuron_count INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_brain_versions_kb ON brain_versions (tenant_id, knowledge_base_id, taken_at DESC);
