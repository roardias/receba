-- Grupos: agrupa empresas (ex: Alldax 1, 2, 3 no grupo "Alldax")
CREATE TABLE IF NOT EXISTS grupos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Empresas: razao_social, nome_curto, chaves API, pertence a um grupo
CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grupo_id UUID REFERENCES grupos(id) ON DELETE SET NULL,
  razao_social TEXT NOT NULL,
  nome_curto TEXT NOT NULL,
  app_key TEXT,
  app_secret TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_empresas_grupo ON empresas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_empresas_nome_curto ON empresas(nome_curto);
