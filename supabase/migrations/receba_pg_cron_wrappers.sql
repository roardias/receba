-- Wrappers seguros para pg_cron + pg_net usados pelo novo scheduler 100% Supabase.
-- NÃO remover nem alterar sem atualizar também docs/MIGRACAO_SCHEDULER_SUPABASE.md.
--
-- Requisitos:
--   - Extensões pg_cron e pg_net habilitadas no projeto.
--   - Vault/variáveis com SUPABASE_URL do projeto e uma API key válida
--     (recomendado: SERVICE_ROLE ou uma chave dedicada com permissão para Edge Functions).
--
-- Convenção de nomes:
--   - Todos os jobs do Receba começam com 'receba_sync_' para que possamos
--     listar/remover só os jobs deste sistema.

-- 1) Garantir extensões (em Supabase normalmente já são habilitadas via UI;
--    aqui deixamos idempotente para ambiente local ou outros Postgres).
DO $$
BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'pg_cron';
  IF NOT FOUND THEN
    CREATE EXTENSION pg_cron;
  END IF;
END$$;

DO $$
BEGIN
  PERFORM 1 FROM pg_extension WHERE extname = 'pg_net';
  IF NOT FOUND THEN
    CREATE EXTENSION pg_net;
  END IF;
END$$;

-- 2) Função wrapper: agenda um job cron com um bloco SQL arbitrário.
--    Usaremos para agendar chamadas net.http_post para Edge Functions.
CREATE OR REPLACE FUNCTION receba_cron_schedule(job_name text, schedule text, sql_block text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_id bigint;
BEGIN
  -- Remove job anterior com o mesmo nome, se existir
  PERFORM cron.unschedule(job_name);

  SELECT cron.schedule(job_name, schedule, sql_block) INTO job_id;
  RETURN job_id;
END;
$$;

COMMENT ON FUNCTION receba_cron_schedule(text, text, text)
  IS 'Wrapper SECURITY DEFINER sobre cron.schedule. Remove job antigo com o mesmo nome antes de agendar o novo.';

-- 3) Função wrapper: remove um job pelo nome (silenciosa se não existir)
CREATE OR REPLACE FUNCTION receba_cron_unschedule(job_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM cron.unschedule(job_name);
END;
$$;

COMMENT ON FUNCTION receba_cron_unschedule(text)
  IS 'Wrapper SECURITY DEFINER sobre cron.unschedule para jobs do Receba.';

-- 4) Função auxiliar: remove TODOS os jobs que começam com ''receba_sync_''.
CREATE OR REPLACE FUNCTION receba_cron_unschedule_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname LIKE 'receba_sync_%'
  LOOP
    PERFORM cron.unschedule(r.jobid);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION receba_cron_unschedule_all()
  IS 'Remove todos os jobs do pg_cron cujo jobname começa com receba_sync_. Usado pelo novo scheduler Supabase.';

