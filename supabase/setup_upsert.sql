-- Execute no Supabase SQL Editor antes de rodar o sync com upsert
-- Permite INSERT ou UPDATE conforme existência do registro

-- 1. Constraint para conflito em (empresa, codigo_cliente_omie)
ALTER TABLE clientes
  ADD CONSTRAINT clientes_empresa_codigo_omie_key UNIQUE (empresa, codigo_cliente_omie);

-- 2. Trigger: atualiza updated_at automaticamente no UPDATE
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS clientes_updated_at ON clientes;
CREATE TRIGGER clientes_updated_at
  BEFORE UPDATE ON clientes
  FOR EACH ROW
  EXECUTE PROCEDURE update_updated_at_column();
