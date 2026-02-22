-- Tabela categorias (Omie)
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS categorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa TEXT NOT NULL,
  codigo TEXT NOT NULL,
  descricao TEXT,
  conta_receita TEXT,

  -- Chave única automática: empresa + codigo
  chave_unica TEXT GENERATED ALWAYS AS (empresa || '_' || codigo) STORED UNIQUE,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categorias_empresa_codigo ON categorias(empresa, codigo);
CREATE INDEX IF NOT EXISTS idx_categorias_empresa ON categorias(empresa);
