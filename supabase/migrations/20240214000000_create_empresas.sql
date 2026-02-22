-- Tabela empresas (tenants) - deve existir antes de clientes
CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  slug TEXT UNIQUE,
  app_key TEXT,
  app_secret_encrypted TEXT,
  logo_url TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_empresas_slug ON empresas(slug);
