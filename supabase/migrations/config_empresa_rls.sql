-- RLS para config_empresa: usuários autenticados podem ler e atualizar
ALTER TABLE config_empresa ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuários autenticados podem ver config_empresa"
  ON config_empresa FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Usuários autenticados podem atualizar config_empresa"
  ON config_empresa FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Usuários autenticados podem inserir config_empresa"
  ON config_empresa FOR INSERT
  TO authenticated
  WITH CHECK (true);
