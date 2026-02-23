-- Garante chave única para upsert: empresa_id + det_nCodTitulo
ALTER TABLE recebimentos_omie
  DROP CONSTRAINT IF EXISTS uq_recebimentos_omie_empresa_titulo;

ALTER TABLE recebimentos_omie
  ADD CONSTRAINT uq_recebimentos_omie_empresa_titulo
  UNIQUE (empresa_id, det_nCodTitulo);
