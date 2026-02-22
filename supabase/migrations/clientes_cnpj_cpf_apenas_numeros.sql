-- cnpj_cpf: apenas números (sem formatação)
-- Execute SE a tabela já tem cnpj_cpf e você nunca rodou a migração de separação

-- 1. Normalizar dados existentes (extrair só dígitos)
UPDATE clientes
SET cnpj_cpf = regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g')
WHERE cnpj_cpf IS NOT NULL AND trim(cnpj_cpf) != ''
  AND cnpj_cpf ~ '[^0-9]';

-- Preencher com zeros: CNPJ 14 dígitos, CPF 11
UPDATE clientes
SET cnpj_cpf = CASE
  WHEN length(regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g')) >= 12
  THEN lpad(left(regexp_replace(cnpj_cpf, '[^0-9]', '', 'g'), 14), 14, '0')
  WHEN length(regexp_replace(COALESCE(cnpj_cpf, ''), '[^0-9]', '', 'g')) BETWEEN 1 AND 11
  THEN lpad(regexp_replace(cnpj_cpf, '[^0-9]', '', 'g'), 11, '0')
  ELSE cnpj_cpf
END
WHERE cnpj_cpf IS NOT NULL AND trim(cnpj_cpf) != '';

-- 2. Constraint: só dígitos (ou NULL)
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_cnpj_cpf_numeros;
ALTER TABLE clientes
  ADD CONSTRAINT chk_cnpj_cpf_numeros
  CHECK (cnpj_cpf IS NULL OR cnpj_cpf ~ '^[0-9]+$');
