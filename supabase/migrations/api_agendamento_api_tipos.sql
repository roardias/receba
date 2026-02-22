-- Adicionar api_tipos para escolher quais APIs agendar (clientes, categorias)
-- Execute no Supabase SQL Editor

ALTER TABLE api_agendamento
  ADD COLUMN IF NOT EXISTS api_tipos TEXT[] DEFAULT ARRAY['clientes'];

-- Migrar agendamentos existentes (sem api_tipos) para clientes
UPDATE api_agendamento
SET api_tipos = ARRAY['clientes']
WHERE api_tipos IS NULL OR api_tipos = '{}';
