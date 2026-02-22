-- Materialized View: Relatório para dashboard (Contas a Receber)
-- Filtros: categorias.conta_receita='S', movimentos.det_ddtprevisao <= hoje
-- REFRESH após sync: REFRESH MATERIALIZED VIEW view_dashboard_receber;

CREATE MATERIALIZED VIEW IF NOT EXISTS view_dashboard_receber AS
SELECT
  m.id AS movimento_id,
  m.empresa,
  m.det_cnumdocfiscal,
  m.det_ddtemissao,
  m.det_ddtprevisao,
  m."ValPago_validado",
  m."ValAberto_validado",
  (CURRENT_DATE - m.det_ddtprevisao)::INTEGER AS qtde_dias,
  c.nome_fantasia,
  (regexp_match(c.nome_fantasia, '^(\d+)\s*-\s*'))[1]::TEXT AS codigo_nome_fantasia,
  c.razao_social,
  c.cnpj_cpf,
  cat.descricao AS categoria_descricao,
  cat.conta_receita
FROM movimentos m
LEFT JOIN clientes c ON m.chave_cliente = c.chave_unica
INNER JOIN categorias cat ON m.chave_categoria = cat.chave_unica AND cat.conta_receita = 'S'
WHERE m.det_ddtprevisao IS NOT NULL
  AND m.det_ddtprevisao <= CURRENT_DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_view_dashboard_receber_id
  ON view_dashboard_receber (movimento_id);

CREATE INDEX IF NOT EXISTS idx_view_dashboard_receber_empresa ON view_dashboard_receber(empresa);
CREATE INDEX IF NOT EXISTS idx_view_dashboard_receber_previsao ON view_dashboard_receber(det_ddtprevisao);
CREATE INDEX IF NOT EXISTS idx_view_dashboard_receber_qtde_dias ON view_dashboard_receber(qtde_dias);
CREATE INDEX IF NOT EXISTS idx_view_dashboard_receber_codigo_nome ON view_dashboard_receber(codigo_nome_fantasia) WHERE codigo_nome_fantasia IS NOT NULL;

COMMENT ON MATERIALIZED VIEW view_dashboard_receber IS 'Dashboard Contas a Receber. Filtro: conta_receita=S, previsao<=hoje. REFRESH após sync.';

-- Função para o scheduler chamar via RPC após sync de movimentos
CREATE OR REPLACE FUNCTION refresh_dashboard_receber()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY view_dashboard_receber;
$$;
