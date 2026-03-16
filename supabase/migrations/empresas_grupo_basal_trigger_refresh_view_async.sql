-- Ajuste: remover REFRESH direto no trigger de empresas_grupo_basal.
-- O REFRESH MATERIALIZED VIEW CONCURRENTLY view_dashboard_receber passa a ser chamado
-- explicitamente pela aplicação (ex.: tela Basal 2026) após o upsert,
-- evitando estourar statement_timeout dentro da transação de escrita.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_empresas_grupo_basal_refresh_view'
  ) THEN
    DROP TRIGGER trg_empresas_grupo_basal_refresh_view ON empresas_grupo_basal;
  END IF;
END;
$$;

-- Mantemos a função refresh_view_dashboard_receber_on_empresas_grupo_basal para eventual uso futuro,
-- mas ela deixa de ser chamada automaticamente em cada INSERT/UPDATE/DELETE.

