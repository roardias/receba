-- Permite que o script de importação (chave anon) insira e delete em cobrancas_realizadas.
-- Use apenas para cargas externas; a chave anon já pode ler via policy existente se necessário.

CREATE POLICY "Anon INSERT cobrancas_realizadas"
  ON cobrancas_realizadas FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon DELETE cobrancas_realizadas"
  ON cobrancas_realizadas FOR DELETE TO anon USING (true);
