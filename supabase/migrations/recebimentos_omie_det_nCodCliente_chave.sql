-- Adiciona det_nCodCliente e chave empresa+cliente à tabela recebimentos_omie (se já existir sem essas colunas)

ALTER TABLE recebimentos_omie
  ADD COLUMN IF NOT EXISTS det_nCodCliente TEXT;

-- chave_empresa_cliente: gerada como empresa || '|' || det_nCodCliente (apenas se a coluna não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recebimentos_omie' AND column_name = 'chave_empresa_cliente'
  ) THEN
    ALTER TABLE recebimentos_omie
      ADD COLUMN chave_empresa_cliente TEXT GENERATED ALWAYS AS (empresa || '|' || COALESCE(det_nCodCliente, '')) STORED;
  END IF;
END $$;

COMMENT ON COLUMN recebimentos_omie.det_nCodCliente IS 'Código do cliente no Omie.';
COMMENT ON COLUMN recebimentos_omie.chave_empresa_cliente IS 'Chave: empresa + det_nCodCliente (gerada automaticamente).';

CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_cod_cliente ON recebimentos_omie(det_nCodCliente);
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_chave_empresa_cliente ON recebimentos_omie(chave_empresa_cliente);
