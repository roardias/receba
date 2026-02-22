-- Substituir chave_unica por chave_categoria em movimentos
-- chave_categoria = empresa + categ_validada, referenciando categorias(chave_unica)
-- Execute no Supabase SQL Editor

-- 1. Remover chave_unica (e sua constraint unique)
ALTER TABLE movimentos DROP CONSTRAINT IF EXISTS movimentos_chave_unica_key;
ALTER TABLE movimentos DROP COLUMN IF EXISTS chave_unica;

-- 2. Adicionar chave_categoria (empresa + categ_validada, formato igual a categorias.chave_unica)
ALTER TABLE movimentos
  ADD COLUMN chave_categoria TEXT GENERATED ALWAYS AS (
    CASE
      WHEN categ_validada IS NOT NULL AND trim(categ_validada) != ''
      THEN empresa || '_' || trim(categ_validada)
      ELSE NULL
    END
  ) STORED;

-- 3. Foreign key: chave_categoria -> categorias(chave_unica)
ALTER TABLE movimentos
  ADD CONSTRAINT fk_movimentos_categorias
  FOREIGN KEY (chave_categoria) REFERENCES categorias(chave_unica);

CREATE INDEX IF NOT EXISTS idx_movimentos_chave_categoria ON movimentos(chave_categoria) WHERE chave_categoria IS NOT NULL;

COMMENT ON COLUMN movimentos.chave_categoria IS 'empresa + categ_validada, referência a categorias(chave_unica)';
