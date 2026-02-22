-- Migração: api_agendamento com múltiplos grupos e empresas
-- Execute no Supabase SQL Editor

-- 1. Adicionar colunas de arrays
ALTER TABLE api_agendamento
  ADD COLUMN IF NOT EXISTS grupo_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS empresa_ids UUID[] DEFAULT '{}';

-- 2. Migrar dados existentes (grupo_id e empresa_id para arrays)
UPDATE api_agendamento
SET grupo_ids = ARRAY[grupo_id]
WHERE grupo_id IS NOT NULL AND (grupo_ids IS NULL OR grupo_ids = '{}');

UPDATE api_agendamento
SET empresa_ids = ARRAY[empresa_id]
WHERE empresa_id IS NOT NULL AND (empresa_ids IS NULL OR empresa_ids = '{}');

-- 3. Remover colunas antigas (se existirem)
ALTER TABLE api_agendamento DROP COLUMN IF EXISTS grupo_id;
ALTER TABLE api_agendamento DROP COLUMN IF EXISTS empresa_id;
ALTER TABLE api_agendamento DROP COLUMN IF EXISTS tipo;
