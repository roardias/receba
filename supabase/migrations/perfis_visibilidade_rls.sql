-- RLS: usuário lê só o próprio; adm/gerencia leem e alteram qualquer perfil

ALTER TABLE perfis_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver próprio ou adm/gerencia perfis_grupos"
  ON perfis_grupos FOR SELECT
  USING (
    auth.uid() = perfil_id
    OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia'))
  );

CREATE POLICY "Alterar perfis_grupos adm gerencia"
  ON perfis_grupos FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_grupos adm gerencia update"
  ON perfis_grupos FOR UPDATE USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_grupos adm gerencia delete"
  ON perfis_grupos FOR DELETE USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));

CREATE POLICY "Ver próprio ou adm/gerencia perfis_empresas"
  ON perfis_empresas FOR SELECT
  USING (
    auth.uid() = perfil_id
    OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia'))
  );

CREATE POLICY "Alterar perfis_empresas adm gerencia"
  ON perfis_empresas FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_empresas adm gerencia update"
  ON perfis_empresas FOR UPDATE USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_empresas adm gerencia delete"
  ON perfis_empresas FOR DELETE USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));

CREATE POLICY "Ver próprio ou adm/gerencia perfis_categorias"
  ON perfis_categorias FOR SELECT
  USING (
    auth.uid() = perfil_id
    OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia'))
  );

CREATE POLICY "Alterar perfis_categorias adm gerencia"
  ON perfis_categorias FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_categorias adm gerencia update"
  ON perfis_categorias FOR UPDATE USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_categorias adm gerencia delete"
  ON perfis_categorias FOR DELETE USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
