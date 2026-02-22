-- Adiciona codigo_nome_fantasia em clientes
-- Extrai o código antes de " - " no nome_fantasia (ex: "1005 - CONSIGOCRED..." -> "1005")
-- Mesma regra usada na view_dashboard_receber

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clientes' AND column_name = 'codigo_nome_fantasia'
  ) THEN
    ALTER TABLE clientes ADD COLUMN codigo_nome_fantasia TEXT
      GENERATED ALWAYS AS ((regexp_match(nome_fantasia, '^(\d+)\s*-\s*'))[1]::TEXT) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clientes_codigo_nome_fantasia
  ON clientes(codigo_nome_fantasia) WHERE codigo_nome_fantasia IS NOT NULL;

COMMENT ON COLUMN clientes.codigo_nome_fantasia IS 'Extraído de nome_fantasia: dígitos antes de " - " (ex: 1005 - NOME -> 1005)';
