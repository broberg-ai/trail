-- F273.3 — HVORNÅR DET SKETE, ikke hvornår det blev gemt.
--
-- `created_at` er det øjeblik Neuronen blev SKREVET. For det meste ligger de to
-- tæt nok på hinanden til at ingen opdager forskellen, og præcis derfor er den
-- farlig. MÅLT i CB-M1 den 15. september 2026: 187 af 946 Neuroner (20 %) blev
-- skrevet i minutter der bærer 5 eller flere rækker — værst 3. september kl.
-- 20:29 og 20:30 med 32 rækker HVERT minut. Det er efter-indlæsninger, ikke
-- minutter hvor der skete 32 ting.
--
-- Spørger man «hvad lærte jeg mellem 20:29 og 20:30», svarer tidsfilteret
-- derfor «32 ting». Teknisk korrekt, menneskeligt forkert.
--
-- Ambient har SENDT et optagetidspunkt hele tiden (relay.ts:205 sætter
-- `capturedAt` i kandidatens metadata). Det blev tabt ved godkendelsen, hvor
-- documents-rækken indsættes uden kandidatens metadata overhovedet.
--
-- NULL BETYDER «IKKE MÅLT», ikke «samtidig med skrivningen». De 946
-- eksisterende rækker beholder NULL — der findes intet optagetidspunkt at
-- udlede for dem, og et gæt ville være værre end et tomt felt.
--
-- Additiv: en ny nullable kolonne. Ingen eksisterende række ændres, og en
-- ældre udgave af koden ignorerer den.
ALTER TABLE documents ADD COLUMN captured_at TEXT;

-- Tidsfilteret spørger på COALESCE(captured_at, created_at), så indekset
-- dækker begge veje gennem den samme forespørgsel.
CREATE INDEX IF NOT EXISTS idx_documents_captured_at
  ON documents (tenant_id, knowledge_base_id, captured_at);
