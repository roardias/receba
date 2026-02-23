-- Recebimentos Omie (liquidados): carga a partir do script api_omie_movimentos - recebimentos.py
-- chave_empresa_cliente = empresa_id || '_' || det_nCodCliente (mesmo formato de clientes.chave_unica) para FK

CREATE TABLE IF NOT EXISTS recebimentos_omie (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),

  empresa TEXT,
  empresa_id UUID REFERENCES empresas(id),
  res_nValPago NUMERIC(14, 2) NOT NULL,
  det_cCPFCNPJCliente TEXT,
  det_dDtPagamento DATE,
  det_dDtPrevisao DATE,
  qtde_dias INTEGER,
  det_nCodTitulo TEXT,
  det_nCodCliente TEXT,
  chave_empresa_cliente TEXT GENERATED ALWAYS AS (
    CASE
      WHEN empresa_id IS NOT NULL AND det_nCodCliente IS NOT NULL AND trim(det_nCodCliente) != ''
      THEN empresa_id::text || '_' || trim(det_nCodCliente)
      ELSE NULL
    END
  ) STORED
);

COMMENT ON TABLE recebimentos_omie IS 'Recebimentos já liquidados da API Omie (ListarMovimentos CR, Liquidado=S). Carga via script api_omie_movimentos - recebimentos.py';
COMMENT ON COLUMN recebimentos_omie.qtde_dias IS 'Diferença em dias: det_dDtPagamento - det_dDtPrevisao';
COMMENT ON COLUMN recebimentos_omie.chave_empresa_cliente IS 'empresa_id || _ || det_nCodCliente, FK para clientes(chave_unica).';

CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_empresa ON recebimentos_omie(empresa);
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_empresa_id ON recebimentos_omie(empresa_id);
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_dt_pagamento ON recebimentos_omie(det_dDtPagamento);
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_cod_titulo ON recebimentos_omie(det_nCodTitulo);
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_cod_cliente ON recebimentos_omie(det_nCodCliente);
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_chave_empresa_cliente ON recebimentos_omie(chave_empresa_cliente) WHERE chave_empresa_cliente IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_cpf_cnpj ON recebimentos_omie(det_cCPFCNPJCliente);

ALTER TABLE recebimentos_omie
  ADD CONSTRAINT fk_recebimentos_omie_clientes
  FOREIGN KEY (chave_empresa_cliente) REFERENCES clientes(chave_unica);

-- RLS: autenticados podem ler; inserir/atualizar/deletar conforme necessidade (ajustar depois)
ALTER TABLE recebimentos_omie ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados SELECT recebimentos_omie"
  ON recebimentos_omie FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados INSERT recebimentos_omie"
  ON recebimentos_omie FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Autenticados DELETE recebimentos_omie"
  ON recebimentos_omie FOR DELETE TO authenticated USING (true);
