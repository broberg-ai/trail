-- F263.1 — jobkøen får en LEASE, så flere arbejdere kan tage fra samme kø.
--
-- Indtil nu var `awaiting_local_compile` et FLAG, ikke en kø. Det har virket
-- fordi der har været præcis én arbejder (en åben cc-session). Det er en
-- egenskab ved ANTALLET, ikke ved designet: to arbejdere ville tage samme
-- kilde, og en arbejder der dør midt i et job efterlader flaget stående for
-- evigt — der er intet der tager det tilbage.
--
-- To kolonner er nok. `claimed_by` er arbejderens identitet (så skyen kan
-- svare på «er der nogen hjemme?», som F263.2 og F263.4 skal bruge), og
-- `lease_until` er en TID og ikke en lås: udløber den, bliver jobbet ledigt
-- af sig selv. En lås skal frigives af den der tog den; en frist behøver
-- ingen at være i live for at udløbe.
ALTER TABLE documents ADD COLUMN compile_claimed_by TEXT;
ALTER TABLE documents ADD COLUMN compile_lease_until TEXT;

-- Claim-forespørgslen leder efter «parkeret OG ledig» inden for én kunde.
CREATE INDEX IF NOT EXISTS idx_documents_compile_queue
  ON documents (tenant_id, awaiting_local_compile, compile_lease_until);
