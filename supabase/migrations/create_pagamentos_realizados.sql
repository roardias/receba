-- Tabela pagamentos_realizados (cópia da estrutura de movimentos - Movimento Financeiro)
-- Filtros e conteúdo podem ser alterados depois.

CREATE TABLE IF NOT EXISTS pagamentos_realizados (
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

  chave_categoria TEXT GENERATED ALWAYS AS (
    CASE
      WHEN categ_validada IS NOT NULL AND trim(categ_validada) != ''
      THEN empresa || '_' || trim(categ_validada)
      ELSE NULL
    END
  ) STORED,

  CONSTRAINT pagamentos_realizados_empresa_titulo_categ_dept_key
  UNIQUE (empresa, det_nCodTitulo, categ_validada, dept_cod),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pagamentos_realizados
  ADD CONSTRAINT fk_pagamentos_realizados_categorias
  FOREIGN KEY (chave_categoria) REFERENCES categorias(chave_unica);

CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_empresa ON pagamentos_realizados(empresa);
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_chave_cliente ON pagamentos_realizados(chave_cliente);
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_chave_titulo ON pagamentos_realizados(chave_titulo);
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_chave_categoria ON pagamentos_realizados(chave_categoria) WHERE chave_categoria IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_det_nCodTitulo ON pagamentos_realizados(empresa, det_nCodTitulo);
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_det_nCodCliente ON pagamentos_realizados(empresa, det_nCodCliente);
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_det_cnpj_cpf ON pagamentos_realizados(empresa, det_cnpj_cpf_apenas_numeros);
CREATE INDEX IF NOT EXISTS idx_pagamentos_realizados_det_dDtEmissao ON pagamentos_realizados(empresa, det_dDtEmissao);

ALTER TABLE pagamentos_realizados
  ADD CONSTRAINT fk_pagamentos_realizados_empresa
  FOREIGN KEY (empresa) REFERENCES empresas(nome_curto);

COMMENT ON TABLE pagamentos_realizados IS 'Cópia da estrutura de movimentos (API pagamentos realizados). Filtros/conteúdo a definir depois.';
