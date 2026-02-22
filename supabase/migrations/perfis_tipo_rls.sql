-- RLS: apenas adm/gerencia podem gerenciar perfis_tipo e tabelas relacionadas

ALTER TABLE perfis_tipo ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_tipo_permissoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_tipo_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_tipo_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE perfis_tipo_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perfis_tipo adm gerencia"
  ON perfis_tipo FOR ALL
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')))
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));

CREATE POLICY "perfis_tipo_permissoes adm gerencia"
  ON perfis_tipo_permissoes FOR ALL
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')))
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));

CREATE POLICY "perfis_tipo_grupos adm gerencia"
  ON perfis_tipo_grupos FOR ALL
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')))
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));

CREATE POLICY "perfis_tipo_empresas adm gerencia"
  ON perfis_tipo_empresas FOR ALL
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')))
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));

CREATE POLICY "perfis_tipo_categorias adm gerencia"
  ON perfis_tipo_categorias FOR ALL
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')))
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
