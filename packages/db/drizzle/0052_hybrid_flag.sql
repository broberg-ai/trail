-- F254.2 — hybrid er slukket som standard, pr. videnbase.
--
-- PR. VIDENBASE OG IKKE GLOBALT, fordi rollout'en er hele sikkerheden: admin
-- først (publikum: os), Aidan sidst (publikum: kunder). Et globalt flag ville
-- gøre den rækkefølge umulig og dermed gøre den første måling til et
-- eksperiment på en kundes chat.
ALTER TABLE knowledge_bases ADD COLUMN hybrid_search_enabled INTEGER NOT NULL DEFAULT 0;
