-- Migração: separar cnpj_cpf em cnpj (14 dígitos) e cpf (11 dígitos)
-- Apenas números, preenchimento com zeros à esquerda. NULL permitido (Omie pode enviar vazio).
-- Execute no Supabase SQL Editor

-- 1. Adicionar colunas
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS cnpj TEXT,
  ADD COLUMN IF NOT EXISTS cpf TEXT;

-- 2. Migrar e normalizar: extrair só dígitos, preencher com zeros
-- CNPJ: 14 dígitos | CPF: 11 dígitos
-- >= 12 dígitos -> CNPJ | 1-11 dígitos -> CPF
UPDATE clientes
SET
  cnpj = CASE
    WHEN length(regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g')) >= 12
    THEN lpad(left(regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g'), 14), 14, '0')
    ELSE NULL
  END,
  cpf = CASE
    WHEN length(regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g')) BETWEEN 1 AND 11
    THEN lpad(regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g'), 11, '0')
    ELSE NULL
  END
WHERE cnpj_cpf IS NOT NULL AND trim(cnpj_cpf) != '';

-- 3. Remover coluna antiga
ALTER TABLE clientes DROP COLUMN IF EXISTS cnpj_cpf;

-- 4. Constraints: apenas dígitos, tamanho fixo (ou NULL)
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_cnpj_formato;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_cpf_formato;

ALTER TABLE clientes
  ADD CONSTRAINT chk_cnpj_formato
  CHECK (cnpj IS NULL OR cnpj ~ '^[0-9]{14}$');

ALTER TABLE clientes
  ADD CONSTRAINT chk_cpf_formato
  CHECK (cpf IS NULL OR cpf ~ '^[0-9]{11}$');

-- 5. Índices (opcional, para buscas)
CREATE INDEX IF NOT EXISTS idx_clientes_cnpj ON clientes(cnpj) WHERE cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clientes_cpf ON clientes(cpf) WHERE cpf IS NOT NULL;
