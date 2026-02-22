-- Relacionamento pagamentos_realizados -> clientes (chave_cliente -> clientes.chave_unica)
-- Igual ao que foi feito em movimentos (movimentos_chave_cliente_fk.sql).

-- 1. Recriar chave_cliente: NULL quando det_nCodCliente vazio (evita FK inválida)
ALTER TABLE pagamentos_realizados DROP COLUMN IF EXISTS chave_cliente;

ALTER TABLE pagamentos_realizados
  ADD COLUMN chave_cliente TEXT GENERATED ALWAYS AS (
    CASE
      WHEN det_ncodcliente IS NOT NULL AND trim(det_ncodcliente) != ''
      THEN empresa || '_' || trim(det_ncodcliente)
      ELSE NULL
    END
  ) STORED;

-- 2. FK para clientes
ALTER TABLE pagamentos_realizados
  ADD CONSTRAINT fk_pagamentos_realizados_clientes
  FOREIGN KEY (chave_cliente) REFERENCES clientes(chave_unica);

-- 3. Índice (já pode existir de create_pagamentos_realizados; IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_chave_cliente
  ON pagamentos_realizados(chave_cliente) WHERE chave_cliente IS NOT NULL;

COMMENT ON COLUMN pagamentos_realizados.chave_cliente IS 'empresa + det_nCodCliente, referência a clientes(chave_unica)';
