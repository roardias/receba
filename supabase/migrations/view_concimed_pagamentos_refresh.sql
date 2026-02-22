-- Função para atualizar a materialized view Concimed (chamada pelo scheduler após sync de pagamentos realizados).
-- Assim o usuário sempre vê dados atualizados após rodar uma nova atualização.

CREATE OR REPLACE FUNCTION refresh_view_concimed_pagamentos_realizados()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY view_concimed_pagamentos_realizados;
END;
$$;

COMMENT ON FUNCTION refresh_view_concimed_pagamentos_realizados() IS
  'Atualiza a view Concimed (pagamentos realizados). Chamada pelo scheduler após sync de pagamentos realizados.';

-- Permite que a API (anon e service_role) execute a função ao chamar supabase.rpc(...)
GRANT EXECUTE ON FUNCTION refresh_view_concimed_pagamentos_realizados() TO anon;
GRANT EXECUTE ON FUNCTION refresh_view_concimed_pagamentos_realizados() TO service_role;
