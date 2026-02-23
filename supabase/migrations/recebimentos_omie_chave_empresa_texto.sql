-- Alinha recebimentos_omie com clientes: chave_empresa_cliente = empresa (nome) || '_' || det_nCodCliente
-- clientes.chave_unica = empresa || '_' || codigo_cliente_omie (empresa = nome_curto)

ALTER TABLE recebimentos_omie DROP CONSTRAINT IF EXISTS fk_recebimentos_omie_clientes;
ALTER TABLE recebimentos_omie DROP CONSTRAINT IF EXISTS fk_recebimentos_omie_clientes_clientes_chave_unica;

ALTER TABLE recebimentos_omie DROP COLUMN IF EXISTS chave_empresa_cliente;

ALTER TABLE recebimentos_omie
  ADD COLUMN chave_empresa_cliente TEXT GENERATED ALWAYS AS (
    CASE
      WHEN empresa IS NOT NULL AND trim(empresa) != '' AND det_nCodCliente IS NOT NULL AND trim(det_nCodCliente) != ''
      THEN trim(empresa) || '_' || trim(det_nCodCliente)
      ELSE NULL
    END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_chave_empresa_cliente ON recebimentos_omie(chave_empresa_cliente) WHERE chave_empresa_cliente IS NOT NULL;

ALTER TABLE recebimentos_omie
  ADD CONSTRAINT fk_recebimentos_omie_clientes
  FOREIGN KEY (chave_empresa_cliente) REFERENCES clientes(chave_unica);

COMMENT ON COLUMN recebimentos_omie.chave_empresa_cliente IS 'empresa (nome_curto) || _ || det_nCodCliente, FK para clientes(chave_unica).';
