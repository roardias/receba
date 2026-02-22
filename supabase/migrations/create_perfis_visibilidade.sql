-- Restrição de visualização por perfil: grupos, empresas e categorias
-- Se não houver nenhum registro, o usuário vê todos (grupos/empresas/categorias)
-- Se houver registros, vê somente os vinculados

CREATE TABLE IF NOT EXISTS perfis_grupos (
  perfil_id UUID NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  grupo_id UUID NOT NULL REFERENCES grupos(id) ON DELETE CASCADE,
  PRIMARY KEY (perfil_id, grupo_id)
);

CREATE TABLE IF NOT EXISTS perfis_empresas (
  perfil_id UUID NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  PRIMARY KEY (perfil_id, empresa_id)
);

CREATE TABLE IF NOT EXISTS perfis_categorias (
  perfil_id UUID NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  categoria_descricao TEXT NOT NULL,
  PRIMARY KEY (perfil_id, categoria_descricao)
);

CREATE INDEX idx_perfis_grupos_perfil ON perfis_grupos(perfil_id);
CREATE INDEX idx_perfis_empresas_perfil ON perfis_empresas(perfil_id);
CREATE INDEX idx_perfis_categorias_perfil ON perfis_categorias(perfil_id);

COMMENT ON TABLE perfis_grupos IS 'Grupos que o usuário pode visualizar no dashboard. Vazio = vê todos.';
COMMENT ON TABLE perfis_empresas IS 'Empresas que o usuário pode visualizar. Vazio = vê todas (dos grupos permitidos).';
COMMENT ON TABLE perfis_categorias IS 'Categorias que o usuário pode visualizar. Vazio = vê todas.';
