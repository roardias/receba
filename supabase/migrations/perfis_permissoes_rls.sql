-- RLS: usuário lê só o próprio; adm/gerencia leem e alteram qualquer

ALTER TABLE perfis_permissoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver próprio ou adm/gerencia perfis_permissoes"
  ON perfis_permissoes FOR SELECT
  USING (
    auth.uid() = perfil_id
    OR EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia'))
  );

CREATE POLICY "Alterar perfis_permissoes adm gerencia"
  ON perfis_permissoes FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_permissoes adm gerencia update"
  ON perfis_permissoes FOR UPDATE
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
CREATE POLICY "Alterar perfis_permissoes adm gerencia delete"
  ON perfis_permissoes FOR DELETE
  USING (EXISTS (SELECT 1 FROM perfis WHERE id = auth.uid() AND role IN ('adm', 'gerencia')));
