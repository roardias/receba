-- Tabela movimentos (Contas a Receber - Omie)
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS movimentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa TEXT NOT NULL,
  categ_validada TEXT,
  dept_cod TEXT,
  det_cnpj_cpf_apenas_numeros TEXT,
  det_cNumDocFiscal TEXT,
  det_dDtEmissao DATE,
  det_dDtPagamento DATE,
  det_dDtPrevisao DATE,
  det_nCodCliente TEXT,
  chave_cliente TEXT GENERATED ALWAYS AS (empresa || '_' || COALESCE(det_nCodCliente, '')) STORED,
  det_nCodTitulo TEXT NOT NULL,
  chave_titulo TEXT GENERATED ALWAYS AS (empresa || '_' || det_nCodTitulo) STORED,
  "ValPago_validado" NUMERIC(20, 5),
  "ValAberto_validado" NUMERIC(20, 5),

  -- Chave única: empresa + titulo + categoria + departamento (cada linha do produto cartesiano)
  chave_unica TEXT GENERATED ALWAYS AS (
    empresa || '_' || det_nCodTitulo || '_' || COALESCE(categ_validada, '') || '_' || COALESCE(dept_cod, '')
  ) STORED UNIQUE,

  UNIQUE (empresa, det_nCodTitulo, categ_validada, dept_cod),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_movimentos_empresa ON movimentos(empresa);
CREATE INDEX IF NOT EXISTS idx_movimentos_chave_cliente ON movimentos(chave_cliente);
CREATE INDEX IF NOT EXISTS idx_movimentos_chave_titulo ON movimentos(chave_titulo);
CREATE INDEX IF NOT EXISTS idx_movimentos_det_nCodTitulo ON movimentos(empresa, det_nCodTitulo);
CREATE INDEX IF NOT EXISTS idx_movimentos_det_nCodCliente ON movimentos(empresa, det_nCodCliente);
CREATE INDEX IF NOT EXISTS idx_movimentos_det_cnpj_cpf ON movimentos(empresa, det_cnpj_cpf_apenas_numeros);
CREATE INDEX IF NOT EXISTS idx_movimentos_det_dDtEmissao ON movimentos(empresa, det_dDtEmissao);

COMMENT ON COLUMN movimentos.det_cnpj_cpf_apenas_numeros IS 'det_cCPFCNPJCliente - somente números (sem pontos, traços, barras)';
COMMENT ON COLUMN movimentos.chave_cliente IS 'empresa + det_nCodCliente - para lookup';
COMMENT ON COLUMN movimentos.chave_titulo IS 'empresa + det_nCodTitulo - para lookup';
