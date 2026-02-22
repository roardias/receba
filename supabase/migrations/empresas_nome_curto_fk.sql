-- empresas.nome_curto como referência única; clientes.empresa e movimentos.empresa como FK
-- Execute no Supabase SQL Editor

-- 1. Garantir nome_curto único em empresas
CREATE UNIQUE INDEX IF NOT EXISTS empresas_nome_curto_key ON empresas(nome_curto);

-- 2. FK: clientes.empresa -> empresas(nome_curto)
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS fk_clientes_empresa;
ALTER TABLE clientes
  ADD CONSTRAINT fk_clientes_empresa
  FOREIGN KEY (empresa) REFERENCES empresas(nome_curto);

-- 3. FK: movimentos.empresa -> empresas(nome_curto)
ALTER TABLE movimentos DROP CONSTRAINT IF EXISTS fk_movimentos_empresa;
ALTER TABLE movimentos
  ADD CONSTRAINT fk_movimentos_empresa
  FOREIGN KEY (empresa) REFERENCES empresas(nome_curto);
