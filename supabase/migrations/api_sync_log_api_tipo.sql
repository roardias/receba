-- Garantir que api_sync_log tenha coluna api_tipo (clientes, categorias)
-- Execute no Supabase SQL Editor

-- Se a tabela já existe, apenas adiciona a coluna (se não tiver)
ALTER TABLE api_sync_log
  ADD COLUMN IF NOT EXISTS api_tipo TEXT DEFAULT 'clientes';

-- Atualizar logs antigos sem api_tipo
UPDATE api_sync_log SET api_tipo = 'clientes' WHERE api_tipo IS NULL;
