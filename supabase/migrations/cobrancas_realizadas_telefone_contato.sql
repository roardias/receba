-- Telefone de contato (ligação/WhatsApp): só números; celular 11 dígitos, fixo 10 dígitos
ALTER TABLE cobrancas_realizadas
  ADD COLUMN IF NOT EXISTS telefone_contato TEXT,
  ADD COLUMN IF NOT EXISTS telefone_tipo TEXT;

ALTER TABLE cobrancas_realizadas
  DROP CONSTRAINT IF EXISTS cobrancas_realizadas_telefone_contato_check,
  DROP CONSTRAINT IF EXISTS cobrancas_realizadas_telefone_tipo_check;

ALTER TABLE cobrancas_realizadas
  ADD CONSTRAINT cobrancas_realizadas_telefone_contato_check
  CHECK (telefone_contato IS NULL OR (telefone_contato ~ '^\d+$' AND length(telefone_contato) BETWEEN 10 AND 11));

ALTER TABLE cobrancas_realizadas
  ADD CONSTRAINT cobrancas_realizadas_telefone_tipo_check
  CHECK (telefone_tipo IS NULL OR telefone_tipo IN ('celular', 'fixo'));

COMMENT ON COLUMN cobrancas_realizadas.telefone_contato IS 'Número usado no contato (só dígitos: celular 11, fixo 10).';
COMMENT ON COLUMN cobrancas_realizadas.telefone_tipo IS 'celular (11 dígitos) ou fixo (10 dígitos).';
