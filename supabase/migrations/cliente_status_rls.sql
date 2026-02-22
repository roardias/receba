-- RLS: usuários autenticados podem ler e atualizar cliente_status (escopo garantido pelo app via empresas visíveis)

ALTER TABLE cliente_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cliente_status select autenticado"
  ON cliente_status FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "cliente_status insert autenticado"
  ON cliente_status FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "cliente_status update autenticado"
  ON cliente_status FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
