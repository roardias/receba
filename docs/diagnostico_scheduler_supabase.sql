-- Diagnóstico: por que o scheduler retorna 0 jobs?
-- Execute no Supabase → SQL Editor e confira os resultados.

-- 1) Agendamentos ativos (o que está na tabela)
SELECT
  id,
  ativo,
  api_tipos,
  grupo_ids,
  empresa_ids,
  dias_semana,
  horarios,
  timezone
FROM api_agendamento
WHERE ativo = true
ORDER BY created_at DESC;

-- 2) Resultado da RPC que a Edge Function usa (deve listar uma linha por empresa)
-- Se der erro "function does not exist", aplique a migration receba_sync_agendamentos_expandidos.sql
SELECT * FROM receba_sync_agendamentos_expandidos();

-- 3) Se a RPC retornar 0 linhas: conferir se empresas têm grupo_id e se api_tipos tem 'clientes'
-- Ex.: grupos existentes e empresas ligadas a eles
SELECT g.id AS grupo_id, g.nome AS grupo_nome, e.id AS empresa_id, e.nome_curto AS empresa_nome, e.ativo
FROM grupos g
LEFT JOIN empresas e ON e.grupo_id = g.id
ORDER BY g.nome, e.nome_curto;
