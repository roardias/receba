-- FK recebimentos_omie.chave_empresa_cliente -> clientes.chave_unica
-- clientes.chave_unica = empresa_id::text || '_' || codigo_cliente_omie
-- Por isso recebimentos_omie precisa de empresa_id e chave no mesmo formato.

-- 1. Adicionar empresa_id (referência a empresas)
ALTER TABLE recebimentos_omie
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_empresa_id ON recebimentos_omie(empresa_id);

-- 2. Recriar chave_empresa_cliente no mesmo formato de clientes.chave_unica (empresa_id || '_' || cod_cliente)
ALTER TABLE recebimentos_omie DROP COLUMN IF EXISTS chave_empresa_cliente;

ALTER TABLE recebimentos_omie
  ADD COLUMN chave_empresa_cliente TEXT GENERATED ALWAYS AS (
    CASE
      WHEN empresa_id IS NOT NULL AND det_nCodCliente IS NOT NULL AND trim(det_nCodCliente) != ''
      THEN empresa_id::text || '_' || trim(det_nCodCliente)
      ELSE NULL
    END
  ) STORED;

COMMENT ON COLUMN recebimentos_omie.chave_empresa_cliente IS 'empresa_id || _ || det_nCodCliente, FK para clientes(chave_unica).';

CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_chave_empresa_cliente ON recebimentos_omie(chave_empresa_cliente) WHERE chave_empresa_cliente IS NOT NULL;

-- 3. Foreign key para clientes (idempotente)
ALTER TABLE recebimentos_omie DROP CONSTRAINT IF EXISTS fk_recebimentos_omie_clientes;
ALTER TABLE recebimentos_omie
  ADD CONSTRAINT fk_recebimentos_omie_clientes
  FOREIGN KEY (chave_empresa_cliente) REFERENCES clientes(chave_unica);
