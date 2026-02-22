-- Perfis reutilizáveis (templates): nome + permissões + visualização
-- Usuário pode ser vinculado a um perfis_tipo e ter suas permissões/visibilidade editadas individualmente

CREATE TABLE IF NOT EXISTS perfis_tipo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS perfis_tipo_permissoes (
  perfis_tipo_id UUID NOT NULL REFERENCES perfis_tipo(id) ON DELETE CASCADE,
  permissao TEXT NOT NULL,
  PRIMARY KEY (perfis_tipo_id, permissao)
);

CREATE TABLE IF NOT EXISTS perfis_tipo_grupos (
  perfis_tipo_id UUID NOT NULL REFERENCES perfis_tipo(id) ON DELETE CASCADE,
  grupo_id UUID NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  PRIMARY KEY (perfis_tipo_id, grupo_id)
);

CREATE TABLE IF NOT EXISTS perfis_tipo_empresas (
  perfis_tipo_id UUID NOT NULL REFERENCES perfis_tipo(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  PRIMARY KEY (perfis_tipo_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS perfis_tipo_categorias (
  perfis_tipo_id UUID NOT NULL REFERENCES perfis_tipo(id) ON DELETE CASCADE,
  categoria_descricao TEXT NOT NULL,
  PRIMARY KEY (perfis_tipo_id, categoria_descricao)
);

CREATE INDEX IF NOT EXISTS idx_perfis_tipo_permissoes ON perfis_tipo_permissoes(perfis_tipo_id);
CREATE INDEX IF NOT EXISTS idx_perfis_tipo_grupos ON perfis_tipo_grupos(perfis_tipo_id);
CREATE INDEX IF NOT EXISTS idx_perfis_tipo_empresas ON perfis_tipo_empresas(perfis_tipo_id);
CREATE INDEX IF NOT EXISTS idx_perfis_tipo_categorias ON perfis_tipo_categorias(perfis_tipo_id);

ALTER TABLE perfis
  ADD COLUMN IF NOT EXISTS perfis_tipo_id UUID REFERENCES perfis_tipo(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_perfis_perfis_tipo ON perfis(perfis_tipo_id);

COMMENT ON TABLE perfis_tipo IS 'Perfis de acesso reutilizáveis (ex.: Vendedor, Financeiro). Ao atribuir a um usuário, pode-se aplicar as permissões e visualização do perfil.';
COMMENT ON COLUMN perfis.perfis_tipo_id IS 'Perfil de acesso atribuído ao usuário (opcional). Configuração do usuário pode ser editada individualmente.';
