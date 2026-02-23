-- Após import de acessorias (upsert): atualiza grupos em clientes e atualiza a view do dashboard.
-- Chamar via RPC do frontend depois do upsert em acessorias (insert ou update).

CREATE OR REPLACE FUNCTION refresh_dashboard_receber_apos_acessorias()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  n INTEGER;
BEGIN
  n := sync_clientes_acessoria_id();
  REFRESH MATERIALIZED VIEW CONCURRENTLY view_dashboard_receber;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION refresh_dashboard_receber_apos_acessorias() IS 'Sync clientes.acessoria_id + refresh view_dashboard_receber. Chamar após import (upsert) de acessorias.';

GRANT EXECUTE ON FUNCTION refresh_dashboard_receber_apos_acessorias() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_dashboard_receber_apos_acessorias() TO service_role;
