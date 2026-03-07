-- ETL Títulos a vencer: só inserir quando det_dDtPrevisao > data de hoje (variável = data do dia na execução)

COMMENT ON TABLE public.titulos_a_vencer IS 'Títulos a vencer (res_cLiquidado=N, det_cGrupo=CONTA_A_RECEBER). ETL: inserir apenas se det_dDtPrevisao > hoje (data do dia, variável).';
