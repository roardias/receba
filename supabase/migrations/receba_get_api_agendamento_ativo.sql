-- Função para leitura de api_agendamento ativos na PRIMARY (evita réplica com lag).
-- Chamada via RPC (POST) no scheduler para garantir dados atualizados.

CREATE OR REPLACE FUNCTION receba_get_api_agendamento_ativo()
RETURNS SETOF api_agendamento
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM api_agendamento WHERE ativo = true;
$$;

COMMENT ON FUNCTION receba_get_api_agendamento_ativo()
  IS 'Retorna linhas ativas de api_agendamento. Usar via RPC no scheduler para ler do primary (evitar lag de réplica).';

GRANT EXECUTE ON FUNCTION receba_get_api_agendamento_ativo() TO service_role;
GRANT EXECUTE ON FUNCTION receba_get_api_agendamento_ativo() TO authenticated;
