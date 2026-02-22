-- RLS: usuários autenticados podem ler e inserir cobranças realizadas

ALTER TABLE cobrancas_realizadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Autenticados SELECT cobrancas_realizadas"
  ON cobrancas_realizadas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Autenticados INSERT cobrancas_realizadas"
  ON cobrancas_realizadas FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Autenticados UPDATE cobrancas_realizadas"
  ON cobrancas_realizadas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Autenticados DELETE cobrancas_realizadas"
  ON cobrancas_realizadas FOR DELETE TO authenticated USING (true);
