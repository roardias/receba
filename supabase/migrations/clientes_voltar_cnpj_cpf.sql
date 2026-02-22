-- Reverter para coluna única cnpj_cpf (apenas números)
-- Execute no Supabase SQL Editor
-- Use este script SE você já executou a migração que separou em cnpj/cpf

-- 1. Adicionar coluna cnpj_cpf
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cnpj_cpf TEXT;

-- 2. Migrar dados (de cnpj ou cpf para cnpj_cpf, se essas colunas existirem)
UPDATE clientes SET cnpj_cpf = COALESCE(cnpj, cpf) WHERE cnpj_cpf IS NULL AND (cnpj IS NOT NULL OR cpf IS NOT NULL);

-- 3. Remover colunas cnpj e cpf (se existirem)
ALTER TABLE clientes DROP COLUMN IF EXISTS cnpj;
ALTER TABLE clientes DROP COLUMN IF EXISTS cpf;

-- 4. Constraint: cnpj_cpf só pode ter dígitos (ou NULL)
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_cnpj_formato;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_cpf_formato;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_cnpj_cpf_numeros;

ALTER TABLE clientes
  ADD CONSTRAINT chk_cnpj_cpf_numeros
  CHECK (cnpj_cpf IS NULL OR cnpj_cpf ~ '^[0-9]+$');
