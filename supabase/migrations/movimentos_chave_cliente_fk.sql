-- chave_cliente em movimentos como FK para clientes(chave_unica)
-- Execute no Supabase SQL Editor

-- Recriar chave_cliente para ser NULL quando det_nCodCliente vazio (evita FK inválida)
ALTER TABLE movimentos DROP COLUMN IF EXISTS chave_cliente;

ALTER TABLE movimentos
  ADD COLUMN chave_cliente TEXT GENERATED ALWAYS AS (
    CASE
      WHEN det_ncodcliente IS NOT NULL AND trim(det_ncodcliente) != ''
      THEN empresa || '_' || trim(det_ncodcliente)
      ELSE NULL
    END
  ) STORED;

ALTER TABLE movimentos
  ADD CONSTRAINT fk_movimentos_clientes
  FOREIGN KEY (chave_cliente) REFERENCES clientes(chave_unica);

CREATE INDEX IF NOT EXISTS idx_movimentos_chave_cliente ON movimentos(chave_cliente) WHERE chave_cliente IS NOT NULL;

COMMENT ON COLUMN movimentos.chave_cliente IS 'empresa + det_nCodCliente, referência a clientes(chave_unica)';
