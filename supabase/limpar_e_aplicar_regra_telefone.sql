-- 1. Limpar tabela clientes
TRUNCATE TABLE clientes RESTART IDENTITY CASCADE;

-- 2. Regra: telefone1 e telefone2 apenas dígitos
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_telefone1_numeros;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS chk_telefone2_numeros;

ALTER TABLE clientes
  ADD CONSTRAINT chk_telefone1_numeros
  CHECK (telefone1 IS NULL OR telefone1 = '' OR telefone1 ~ '^[0-9]+$');

ALTER TABLE clientes
  ADD CONSTRAINT chk_telefone2_numeros
  CHECK (telefone2 IS NULL OR telefone2 = '' OR telefone2 ~ '^[0-9]+$');
