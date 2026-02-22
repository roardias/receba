-- RLS: usuários autenticados podem gerenciar configurações de e-mail

ALTER TABLE config_email ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_email_empresas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados SELECT config_email"
  ON config_email FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados INSERT config_email"
  ON config_email FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Autenticados UPDATE config_email"
  ON config_email FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Autenticados DELETE config_email"
  ON config_email FOR DELETE TO authenticated USING (true);

CREATE POLICY "Autenticados SELECT config_email_empresas"
  ON config_email_empresas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados INSERT config_email_empresas"
  ON config_email_empresas FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Autenticados DELETE config_email_empresas"
  ON config_email_empresas FOR DELETE TO authenticated USING (true);
