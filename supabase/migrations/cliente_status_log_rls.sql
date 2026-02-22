-- RLS: log é preenchido pelo trigger (SECURITY DEFINER). Usuários autenticados podem ler para relatórios.

ALTER TABLE cliente_status_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_status_log select autenticado"
  ON cliente_status_log FOR SELECT
  TO authenticated
  USING (true);

-- Inserção feita apenas pelo trigger em cliente_status (função SECURITY DEFINER)
