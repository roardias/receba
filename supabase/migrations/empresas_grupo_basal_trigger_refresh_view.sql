-- Sempre que houver alteração em empresas_grupo_basal, atualizar a view_dashboard_receber
-- para que o grupo das empresas "Tax" seja refletido na aplicação (incl. Vercel).

CREATE OR REPLACE FUNCTION refresh_view_dashboard_receber_on_empresas_grupo_basal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY view_dashboard_receber;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_empresas_grupo_basal_refresh_view ON empresas_grupo_basal;

CREATE TRIGGER trg_empresas_grupo_basal_refresh_view
  AFTER INSERT OR UPDATE OR DELETE ON empresas_grupo_basal
  FOR EACH STATEMENT
  EXECUTE PROCEDURE refresh_view_dashboard_receber_on_empresas_grupo_basal();

COMMENT ON FUNCTION refresh_view_dashboard_receber_on_empresas_grupo_basal() IS 'Atualiza view_dashboard_receber após mudança em empresas_grupo_basal (grupo Tax).';
