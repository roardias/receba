-- ============================================
-- Tabela clientes - campos vindos do CSV
-- Execute no Supabase SQL Editor
-- ============================================

-- Tabela clientes (dados do Omie)
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa TEXT NOT NULL,
  cnpj_cpf TEXT,
  codigo_cliente_omie TEXT NOT NULL,
  email TEXT,
  contato TEXT,
  nome_fantasia TEXT,
  razao_social TEXT,
  telefone1 TEXT,  -- telefone1_ddd + telefone1_numero (concat no CSV)
  telefone2 TEXT,  -- telefone2_ddd + telefone2_numero (concat no CSV)

  -- Chave única automática no banco: empresa + codigo_cliente_omie
  chave_unica TEXT GENERATED ALWAYS AS (empresa || '_' || codigo_cliente_omie) STORED UNIQUE,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clientes_empresa ON clientes(empresa);
CREATE INDEX IF NOT EXISTS idx_clientes_codigo_omie ON clientes(empresa, codigo_cliente_omie);
