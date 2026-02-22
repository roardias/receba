-- Garantir constraint única para upsert de movimentos
-- Execute no Supabase SQL Editor se o ON CONFLICT falhar

-- Adiciona constraint única nomeada (para upsert por empresa+titulo+categ+dept)
ALTER TABLE movimentos
  DROP CONSTRAINT IF EXISTS movimentos_empresa_titulo_categ_dept_key;

ALTER TABLE movimentos
  ADD CONSTRAINT movimentos_empresa_titulo_categ_dept_key
  UNIQUE (empresa, det_ncodtitulo, categ_validada, dept_cod);
