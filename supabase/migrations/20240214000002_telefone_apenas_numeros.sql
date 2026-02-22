-- Regra: telefone1 e telefone2 só podem conter dígitos (sem espaços ou caracteres especiais)
-- Vazio é permitido (NULL ou '')

-- 1. Normaliza dados existentes (remove não-dígitos)
UPDATE clientes SET telefone1 = regexp_replace(telefone1, '[^0-9]', '', 'g') WHERE telefone1 IS NOT NULL AND telefone1 != '';
UPDATE clientes SET telefone2 = regexp_replace(telefone2, '[^0-9]', '', 'g') WHERE telefone2 IS NOT NULL AND telefone2 != '';

-- 2. Adiciona constraint
ALTER TABLE clientes
  ADD CONSTRAINT chk_telefone1_numeros
  CHECK (telefone1 IS NULL OR telefone1 = '' OR telefone1 ~ '^[0-9]+$');

ALTER TABLE clientes
  ADD CONSTRAINT chk_telefone2_numeros
  CHECK (telefone2 IS NULL OR telefone2 = '' OR telefone2 ~ '^[0-9]+$');
