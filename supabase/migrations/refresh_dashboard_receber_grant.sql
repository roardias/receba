-- Permite que usuários autenticados chamem refresh_dashboard_receber (botão "Forçar atualização" na Relação inadimplentes).
GRANT EXECUTE ON FUNCTION refresh_dashboard_receber() TO authenticated;
GRANT EXECUTE ON FUNCTION refresh_dashboard_receber() TO service_role;
