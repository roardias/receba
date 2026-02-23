-- Preenche grupo_empresas e tag_top_40 na view buscando em acessorias também pelo código (id_planilha = codigo_nome_fantasia).
-- Assim, mesmo quando clientes.acessoria_id está NULL, o grupo não se perde se o código existir em acessorias.

DROP MATERIALIZED VIEW IF EXISTS view_dashboard_receber;

CREATE MATERIALIZED VIEW view_dashboard_receber AS
SELECT
  m.id AS movimento_id,
  m.chave_cliente,
  m.empresa,
  m.det_cnumdocfiscal,
  m.det_ddtemissao,
  m.det_ddtprevisao,
  m."ValPago_validado",
  m."ValAberto_validado",
  (CURRENT_DATE - m.det_ddtprevisao)::INTEGER AS qtde_dias,
  INITCAP(TRIM(COALESCE(c.nome_fantasia, ''))) AS nome_fantasia,
  (regexp_match(c.nome_fantasia, '^(\d+)\s*-\s*'))[1]::TEXT AS codigo_nome_fantasia,
  INITCAP(TRIM(COALESCE(c.razao_social, ''))) AS razao_social,
  c.cnpj_cpf,
  cat.descricao AS categoria_descricao,
  cat.conta_receita,
  COALESCE(a.tag_top_40, a_cod.tag_top_40) AS tag_top_40,
  COALESCE(a.grupo_empresas, a_cod.grupo_empresas) AS grupo_empresas
FROM movimentos m
LEFT JOIN clientes c ON m.chave_cliente = c.chave_unica
LEFT JOIN acessorias a ON c.acessoria_id = a.id
LEFT JOIN acessorias a_cod ON a_cod.id_planilha = (regexp_match(c.nome_fantasia, '^(\d+)\s*-\s*'))[1]::TEXT
INNER JOIN categorias cat ON m.chave_categoria = cat.chave_unica AND cat.conta_receita = 'S'
WHERE m.det_ddtprevisao IS NOT NULL
  AND m.det_ddtprevisao <= CURRENT_DATE;

CREATE UNIQUE INDEX idx_view_dashboard_receber_id ON view_dashboard_receber (movimento_id);
CREATE INDEX idx_view_dashboard_receber_empresa ON view_dashboard_receber(empresa);
CREATE INDEX idx_view_dashboard_receber_previsao ON view_dashboard_receber(det_ddtprevisao);
CREATE INDEX idx_view_dashboard_receber_qtde_dias ON view_dashboard_receber(qtde_dias);
CREATE INDEX idx_view_dashboard_receber_codigo_nome ON view_dashboard_receber(codigo_nome_fantasia) WHERE codigo_nome_fantasia IS NOT NULL;
CREATE INDEX idx_view_dashboard_receber_tag_top_40 ON view_dashboard_receber(tag_top_40) WHERE tag_top_40 IS NOT NULL;
CREATE INDEX idx_view_dashboard_receber_grupo_empresas ON view_dashboard_receber(grupo_empresas);
CREATE INDEX idx_view_dashboard_receber_chave_cliente ON view_dashboard_receber(chave_cliente) WHERE chave_cliente IS NOT NULL;

COMMENT ON MATERIALIZED VIEW view_dashboard_receber IS 'Dashboard Contas a Receber. Grupo/tag: acessorias por acessoria_id ou por id_planilha=codigo. REFRESH após sync.';
