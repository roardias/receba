-- Tabela acessorias - importada de planilha de cadastro
-- Colunas: ID (planilha), Grupo de Empresas, Razão Social, Top - 40 (extraído de Tags)

CREATE TABLE IF NOT EXISTS acessorias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_planilha TEXT NOT NULL,
  grupo_empresas TEXT NOT NULL,
  razao_social TEXT,
  tag_top_40 TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acessorias_id_planilha ON acessorias(id_planilha);
CREATE INDEX IF NOT EXISTS idx_acessorias_grupo ON acessorias(grupo_empresas);
CREATE INDEX IF NOT EXISTS idx_acessorias_tag_top_40 ON acessorias(tag_top_40) WHERE tag_top_40 IS NOT NULL;

COMMENT ON TABLE acessorias IS 'Cadastro importado de planilha. tag_top_40 = Top - 40 quando existir na coluna Tags.';

-- RLS: permitir acesso ao frontend (ajuste conforme sua política de segurança)
ALTER TABLE acessorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir todos em acessorias" ON acessorias
  FOR ALL USING (true) WITH CHECK (true);
