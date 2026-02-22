-- Tabela clientes (dados do Omie, multi-tenant)
-- Chave única: empresa_id + codigo_cliente_omie
-- Depende de: 20240214000000_create_empresas.sql

CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo_cliente_omie TEXT NOT NULL,
  cnpj_cpf TEXT,
  email TEXT,
  contato TEXT,
  nome_fantasia TEXT,
  razao_social TEXT,
  telefone1 TEXT,
  telefone2 TEXT,

  -- Chave única automática: empresa + codigo_cliente_omie
  chave_unica TEXT GENERATED ALWAYS AS (empresa_id::text || '_' || codigo_cliente_omie) STORED UNIQUE,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para busca
CREATE INDEX idx_clientes_empresa_id ON clientes(empresa_id);
CREATE INDEX idx_clientes_codigo_omie ON clientes(empresa_id, codigo_cliente_omie);
CREATE INDEX idx_clientes_cnpj_cpf ON clientes(empresa_id, cnpj_cpf);
CREATE INDEX idx_clientes_razao_social ON clientes(empresa_id, razao_social);

-- RLS (Row Level Security) - descomentar quando tabela usuarios existir
-- ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY clientes_empresa_isolation ON clientes
--   FOR ALL USING (empresa_id = (SELECT empresa_id FROM usuarios WHERE id = auth.uid()));

COMMENT ON COLUMN clientes.chave_unica IS 'Gerada automaticamente: empresa_id || _ || codigo_cliente_omie (UNIQUE)';
