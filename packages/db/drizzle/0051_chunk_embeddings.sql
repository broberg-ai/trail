-- F254.1 — vektorer ved siden af tekststykkerne.
--
-- EGEN TABEL, IKKE EN KOLONNE PÅ document_chunks. Tre grunde, og den sidste er
-- den bærende:
--   1. En chunk kan findes UDEN en vektor (ny, fejlet, midt i en bagfyldning).
--      En kolonne ville gøre den tilstand til NULL, og NULL i en beregning er
--      præcis den tavse degradering vi har brugt natten på at fjerne.
--   2. Skifter modellen dimension, kan gammel og ny leve side om side mens der
--      genindekseres — i stedet for at halvdelen af basen bliver usammenlignelig
--      i det sekund konfigurationen ændres.
--   3. Vektorerne kan slettes og bygges om uden at røre teksten. Chunken er
--      sandheden; vektoren er en afledt ting.
--
-- BLOB, IKKE JSON. 1024 float32 er 4 KB rå og ~11 KB som JSON-tekst. Ved 202
-- Neuroner er begge dele ligegyldigt; ved 6.796 er det 27 MB mod 75 MB, og
-- afkodningen af JSON ville dominere selve sammenligningen.
--
-- INTET VEKTOR-INDEKS. Målt 6. september: største videnbase er 202 Neuroner
-- ≈ 2,4 MB vektorer. En ligeud-sammenligning af alle er hurtigere end at
-- vedligeholde et HNSW-indeks, og den kan ikke give et forkert svar på grund af
-- en indeks-parameter ingen forstår. Tages op igen ved ~50.000 tekststykker i
-- ÉN videnbase — et målt tal, ikke en fornemmelse.
CREATE TABLE IF NOT EXISTS chunk_embeddings (
  chunk_id TEXT PRIMARY KEY NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  knowledge_base_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  -- float32 little-endian, dimension styk. Se dims.
  vector BLOB NOT NULL,
  dims INTEGER NOT NULL,
  -- Hvilken model der lavede den. Uden dette felt kan to vektorer fra
  -- forskellige modeller sammenlignes, og resultatet er meningsløst uden at
  -- være forkert på nogen målbar måde.
  model TEXT NOT NULL,
  -- Hash af den tekst der blev indekseret. Ændrer chunken sig, er vektoren
  -- forældet — og det kan ses uden at kalde modellen igen.
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunk_emb_kb ON chunk_embeddings (tenant_id, knowledge_base_id);
CREATE INDEX IF NOT EXISTS idx_chunk_emb_doc ON chunk_embeddings (document_id);
