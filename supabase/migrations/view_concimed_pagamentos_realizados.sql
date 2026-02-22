-- View Concimed: pagamentos realizados com categorias Repasse Ecografia / Repasse Médico
-- Apenas empresas do GRUPO Concimed (grupos.nome). Uma linha por (cliente, ano, mês) com valor somado.
-- O nome exibido (razao_social) vem SEMPRE da tabela clientes (razao_social ou nome_fantasia), com INITCAP.
-- O frontend monta as colunas por mês/ano dinamicamente.

DROP MATERIALIZED VIEW IF EXISTS view_concimed_pagamentos_realizados;

CREATE MATERIALIZED VIEW view_concimed_pagamentos_realizados AS
SELECT
  pr.empresa,
  pr.chave_cliente,
  INITCAP(TRIM(MAX(COALESCE(c.razao_social, c.nome_fantasia, '')))) AS razao_social,
  MAX(COALESCE(
    regexp_replace(COALESCE(c.cnpj_cpf, pr.det_cnpj_cpf_apenas_numeros), '[^0-9]', '', 'g'),
    ''
  )) AS cnpj_cpf_apenas_numeros,
  EXTRACT(YEAR FROM pr.det_ddtpagamento)::INTEGER AS ano,
  EXTRACT(MONTH FROM pr.det_ddtpagamento)::INTEGER AS mes,
  SUM(pr."ValPago_validado") AS valor_pago_corrigido
FROM pagamentos_realizados pr
INNER JOIN empresas e ON e.nome_curto = pr.empresa
INNER JOIN grupos g ON g.id = e.grupo_id AND g.nome ILIKE '%Concimed%'
INNER JOIN categorias cat
  ON pr.chave_categoria = cat.chave_unica
  AND (cat.descricao ILIKE '%Repasse Ecografia%' OR cat.descricao ILIKE '%Repasse Médico%')
LEFT JOIN clientes c ON pr.chave_cliente = c.chave_unica
WHERE pr.det_ddtpagamento IS NOT NULL
GROUP BY pr.empresa, pr.chave_cliente,
  EXTRACT(YEAR FROM pr.det_ddtpagamento),
  EXTRACT(MONTH FROM pr.det_ddtpagamento);

CREATE UNIQUE INDEX idx_view_concimed_pagamentos_uniq
  ON view_concimed_pagamentos_realizados (empresa, chave_cliente, ano, mes);
CREATE INDEX idx_view_concimed_pagamentos_razao
  ON view_concimed_pagamentos_realizados (razao_social);
CREATE INDEX idx_view_concimed_pagamentos_cnpj_cpf
  ON view_concimed_pagamentos_realizados (cnpj_cpf_apenas_numeros);
CREATE INDEX idx_view_concimed_pagamentos_ano_mes
  ON view_concimed_pagamentos_realizados (ano, mes);

COMMENT ON MATERIALIZED VIEW view_concimed_pagamentos_realizados IS
  'Concimed: uma linha por (cliente, ano, mês) com valor pago. Repasse Ecografia/Repasse Médico. Frontend monta colunas por mês.';
