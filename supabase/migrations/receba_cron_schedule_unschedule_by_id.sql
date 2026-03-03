-- Corrige receba_cron_schedule: unschedule por jobid (nome pode não ser suportado em todas as versões do pg_cron)
-- e garante search_path com net para o comando agendado encontrar net.http_post.
-- Rode no SQL Editor do Supabase se os jobs falharem com "could not find".

CREATE OR REPLACE FUNCTION receba_cron_schedule(job_name text, schedule text, sql_block text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  job_id bigint;
  old_id bigint;
BEGIN
  -- Remove job anterior com o mesmo nome (por id, compatível com pg_cron que só tem unschedule(bigint))
  SELECT j.jobid INTO old_id
  FROM cron.job j
  WHERE j.jobname = receba_cron_schedule.job_name
  LIMIT 1;
  IF old_id IS NOT NULL THEN
    PERFORM cron.unschedule(old_id);
  END IF;

  SELECT cron.schedule(job_name, schedule, sql_block) INTO job_id;
  RETURN job_id;
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION receba_cron_schedule(text, text, text)
  IS 'Agenda job pg_cron. Remove anterior por nome (via jobid). search_path inclui net para net.http_post.';
