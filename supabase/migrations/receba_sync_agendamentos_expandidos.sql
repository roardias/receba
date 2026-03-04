-- Retorna agendamentos ativos expandidos: um registro por (empresa_id, dias_semana, horarios, api_tipos, timezone).
-- Quando o agendamento é por grupo, expande grupo_ids para as empresas do grupo (ativo = true).
-- Usado pela Edge Function receba-sync-scheduler para criar jobs pg_cron sem duplicar lógica.
-- Não remover sem atualizar docs/MIGRACAO_SCHEDULER_SUPABASE.md e a Edge Function.

CREATE OR REPLACE FUNCTION receba_sync_agendamentos_expandidos()
RETURNS TABLE (
  empresa_id uuid,
  dias_semana integer[],
  horarios text[],
  api_tipos text[],
  timezone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ag AS (
    SELECT
      a.id,
      a.dias_semana,
      a.horarios,
      a.api_tipos,
      COALESCE(NULLIF(trim(a.timezone), ''), 'America/Sao_Paulo') AS tz,
      a.empresa_ids,
      a.grupo_ids
    FROM api_agendamento a
    WHERE a.ativo = true
      AND (
        (a.empresa_ids IS NOT NULL AND array_length(a.empresa_ids, 1) > 0)
        OR (a.grupo_ids IS NOT NULL AND array_length(a.grupo_ids, 1) > 0)
      )
  )
  SELECT
    e.id AS empresa_id,
    ag.dias_semana,
    ag.horarios,
    ag.api_tipos,
    ag.tz AS timezone
  FROM ag
  JOIN empresas e ON e.ativo = true
    AND (
      (ag.empresa_ids IS NOT NULL AND array_length(ag.empresa_ids, 1) > 0 AND e.id = ANY(ag.empresa_ids))
      OR (
        (ag.empresa_ids IS NULL OR array_length(ag.empresa_ids, 1) IS NULL OR array_length(ag.empresa_ids, 1) = 0)
        AND ag.grupo_ids IS NOT NULL AND array_length(ag.grupo_ids, 1) > 0 AND e.grupo_id = ANY(ag.grupo_ids)
      )
    );
$$;

COMMENT ON FUNCTION receba_sync_agendamentos_expandidos()
  IS 'Agendamentos ativos com clientes expandidos por empresa (grupos viram lista de empresas). Usado por receba-sync-scheduler.';
