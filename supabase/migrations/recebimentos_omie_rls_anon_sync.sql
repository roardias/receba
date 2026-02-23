-- Permite que o sync (backend) insira/atualize em recebimentos_omie.
-- Sem isso: "new row violates row-level security policy" (42501).

-- Anon: INSERT e UPDATE (sync com chave anon)
DROP POLICY IF EXISTS "Anon INSERT recebimentos_omie" ON recebimentos_omie;
CREATE POLICY "Anon INSERT recebimentos_omie"
  ON recebimentos_omie FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Anon UPDATE recebimentos_omie" ON recebimentos_omie;
CREATE POLICY "Anon UPDATE recebimentos_omie"
  ON recebimentos_omie FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Service_role: INSERT e UPDATE (sync com chave service_role; em alguns projetos RLS ainda é aplicado)
DROP POLICY IF EXISTS "Service role INSERT recebimentos_omie" ON recebimentos_omie;
CREATE POLICY "Service role INSERT recebimentos_omie"
  ON recebimentos_omie FOR INSERT TO service_role WITH CHECK (true);
DROP POLICY IF EXISTS "Service role UPDATE recebimentos_omie" ON recebimentos_omie;
CREATE POLICY "Service role UPDATE recebimentos_omie"
  ON recebimentos_omie FOR UPDATE TO service_role USING (true) WITH CHECK (true);
