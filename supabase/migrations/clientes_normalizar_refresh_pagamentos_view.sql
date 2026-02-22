-- Garante que nomes em clientes estejam normalizados (INITCAP) e que a view de
-- pagamentos realizados use apenas clientes como origem do nome e seja atualizada.

-- 1. Reaplicar normalização em clientes (idempotente; corrige registros que ainda estavam em maiúsculas)
UPDATE clientes
SET razao_social = INITCAP(TRIM(COALESCE(razao_social, '')))
WHERE TRIM(COALESCE(razao_social, '')) != ''
  AND razao_social != INITCAP(TRIM(COALESCE(razao_social, '')));

UPDATE clientes
SET nome_fantasia = INITCAP(TRIM(COALESCE(nome_fantasia, '')))
WHERE TRIM(COALESCE(nome_fantasia, '')) != ''
  AND nome_fantasia != INITCAP(TRIM(COALESCE(nome_fantasia, '')));

-- 2. Recriar a materialized view (view_controle_dividendos_ata_2025 depende dela → drop e recriar na ordem)
DROP VIEW IF EXISTS view_controle_dividendos_ata_2025;
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
  'Concimed: uma linha por (cliente, ano, mês) com valor pago. Nome sempre da tabela clientes (razao_social ou nome_fantasia), INITCAP.';

-- 3. Recriar a view que depende da materialized view
CREATE OR REPLACE VIEW view_controle_dividendos_ata_2025 AS
WITH RECURSIVE iris_id AS (
  SELECT '1012591f-e0c0-414a-b739-33224aa6290e'::UUID AS id
),
iris_empresa AS (
  SELECT e.id, e.nome_curto,
    TRIM(COALESCE(e.razao_social, '')) AS empresa_razao_social,
    e.cnpj AS empresa_cnpj
  FROM empresas e
  WHERE e.id = (SELECT id FROM iris_id)
),
detalhe AS (
  SELECT
    v.empresa AS empresa_pagamento,
    (SELECT ie.empresa_razao_social FROM iris_empresa ie LIMIT 1) AS empresa_razao_social,
    (SELECT ie.empresa_cnpj FROM iris_empresa ie LIMIT 1) AS empresa_cnpj,
    v.cnpj_cpf_apenas_numeros AS cpf,
    d.nome,
    v.ano,
    v.mes,
    v.valor_pago_corrigido AS valor_pago
  FROM view_concimed_pagamentos_realizados v
  INNER JOIN empresas e ON e.nome_curto = v.empresa AND e.id = (SELECT id FROM iris_id)
  INNER JOIN dividendos_ata_2025 d ON d.cpf = v.cnpj_cpf_apenas_numeros
    AND d.empresa_id = (SELECT id FROM iris_id)
),
sem_linha_jan26 AS (
  SELECT
    (SELECT nome_curto FROM iris_empresa LIMIT 1) AS empresa_pagamento,
    (SELECT empresa_razao_social FROM iris_empresa LIMIT 1) AS empresa_razao_social,
    (SELECT empresa_cnpj FROM iris_empresa LIMIT 1) AS empresa_cnpj,
    d.cpf,
    d.nome,
    2026 AS ano,
    1 AS mes,
    0::NUMERIC(20,2) AS valor_pago
  FROM dividendos_ata_2025 d
  WHERE d.empresa_id = (SELECT id FROM iris_id)
    AND NOT EXISTS (
      SELECT 1 FROM detalhe d2
      WHERE d2.cpf = d.cpf
        AND (d2.ano > 2026 OR (d2.ano = 2026 AND d2.mes >= 1))
    )
),
detalhe_completo AS (
  SELECT empresa_pagamento, empresa_razao_social, empresa_cnpj, cpf, nome, ano, mes, valor_pago FROM detalhe
  UNION ALL
  SELECT empresa_pagamento, empresa_razao_social, empresa_cnpj, cpf, nome, ano, mes, valor_pago FROM sem_linha_jan26
),
totais_mes AS (
  SELECT
    cpf,
    ano,
    mes,
    SUM(valor_pago) AS total_pago_mes
  FROM detalhe_completo
  WHERE (ano > 2026) OR (ano = 2026 AND mes >= 1)
  GROUP BY cpf, ano, mes
),
ordenado AS (
  SELECT
    t.cpf,
    d.nome,
    t.ano,
    t.mes,
    t.total_pago_mes,
    d.valor_ata,
    ROW_NUMBER() OVER (PARTITION BY t.cpf ORDER BY t.ano, t.mes) AS rn
  FROM totais_mes t
  INNER JOIN (SELECT cpf, nome, valor_ata FROM dividendos_ata_2025 WHERE empresa_id = (SELECT id FROM iris_id)) d ON d.cpf = t.cpf
),
rec AS (
  SELECT
    o.cpf,
    o.nome,
    o.ano,
    o.mes,
    (o.total_pago_mes)::NUMERIC(20,2) AS total_pago_mes,
    (o.valor_ata)::NUMERIC(20,2) AS saldo_ata_inicial,
    (CASE
      WHEN o.valor_ata = 1000 THEN (o.total_pago_mes - LEAST(o.total_pago_mes, o.valor_ata))::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND o.valor_ata > 50000 THEN 50000::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND o.valor_ata <= 50000 AND o.valor_ata > 0 THEN (o.total_pago_mes - o.valor_ata)::NUMERIC(20,2)
      ELSE o.total_pago_mes::NUMERIC(20,2)
    END) AS competencia_mes,
    (CASE
      WHEN o.valor_ata = 1000 THEN LEAST(o.total_pago_mes, o.valor_ata)::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND o.valor_ata > 50000 THEN LEAST(o.total_pago_mes - 50000, o.valor_ata)::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND o.valor_ata <= 50000 AND o.valor_ata > 0 THEN o.valor_ata::NUMERIC(20,2)
      ELSE 0::NUMERIC(20,2)
    END) AS baixa_ata_mes,
    (CASE
      WHEN o.valor_ata = 1000 THEN (o.valor_ata - LEAST(o.total_pago_mes, o.valor_ata))::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND o.valor_ata > 50000 THEN GREATEST(0, o.valor_ata - LEAST(o.total_pago_mes - 50000, o.valor_ata))::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND o.valor_ata <= 50000 AND o.valor_ata > 0 THEN 0::NUMERIC(20,2)
      ELSE o.valor_ata::NUMERIC(20,2)
    END) AS saldo_ata_final,
    o.rn
  FROM ordenado o
  WHERE o.rn = 1
  UNION ALL
  SELECT
    o.cpf,
    o.nome,
    o.ano,
    o.mes,
    (o.total_pago_mes)::NUMERIC(20,2) AS total_pago_mes,
    (r.saldo_ata_final)::NUMERIC(20,2) AS saldo_ata_inicial,
    (CASE
      WHEN r.saldo_ata_final = 0 THEN o.total_pago_mes::NUMERIC(20,2)
      WHEN o.valor_ata = 1000 AND r.saldo_ata_final > 0 THEN (o.total_pago_mes - LEAST(o.total_pago_mes, r.saldo_ata_final))::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND r.saldo_ata_final > 50000 THEN 50000::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND r.saldo_ata_final <= 50000 AND r.saldo_ata_final > 0 THEN (o.total_pago_mes - r.saldo_ata_final)::NUMERIC(20,2)
      ELSE o.total_pago_mes::NUMERIC(20,2)
    END) AS competencia_mes,
    (CASE
      WHEN r.saldo_ata_final = 0 THEN 0::NUMERIC(20,2)
      WHEN o.valor_ata = 1000 AND r.saldo_ata_final > 0 THEN LEAST(o.total_pago_mes, r.saldo_ata_final)::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND r.saldo_ata_final > 50000 THEN LEAST(o.total_pago_mes - 50000, r.saldo_ata_final)::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND r.saldo_ata_final <= 50000 AND r.saldo_ata_final > 0 THEN r.saldo_ata_final::NUMERIC(20,2)
      ELSE 0::NUMERIC(20,2)
    END) AS baixa_ata_mes,
    (CASE
      WHEN r.saldo_ata_final = 0 THEN 0::NUMERIC(20,2)
      WHEN o.valor_ata = 1000 AND r.saldo_ata_final > 0 THEN (r.saldo_ata_final - LEAST(o.total_pago_mes, r.saldo_ata_final))::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND r.saldo_ata_final > 50000 THEN GREATEST(0, r.saldo_ata_final - LEAST(o.total_pago_mes - 50000, r.saldo_ata_final))::NUMERIC(20,2)
      WHEN o.total_pago_mes > 50000 AND r.saldo_ata_final <= 50000 AND r.saldo_ata_final > 0 THEN 0::NUMERIC(20,2)
      ELSE r.saldo_ata_final::NUMERIC(20,2)
    END) AS saldo_ata_final,
    o.rn
  FROM ordenado o
  INNER JOIN rec r ON r.cpf = o.cpf AND o.rn = r.rn + 1
),
controle_mes AS (
  SELECT cpf, nome, ano, mes, total_pago_mes, saldo_ata_inicial, competencia_mes, baixa_ata_mes, saldo_ata_final
  FROM rec
)
SELECT
  det.empresa_pagamento,
  det.empresa_razao_social,
  det.empresa_cnpj,
  det.cpf,
  det.nome,
  det.ano,
  det.mes,
  det.valor_pago,
  c.total_pago_mes,
  c.saldo_ata_inicial,
  c.competencia_mes,
  c.baixa_ata_mes,
  c.saldo_ata_final
FROM detalhe_completo det
INNER JOIN controle_mes c ON c.cpf = det.cpf AND c.ano = det.ano AND c.mes = det.mes
WHERE c.saldo_ata_inicial > 0
ORDER BY det.nome, det.ano, det.mes;

COMMENT ON VIEW view_controle_dividendos_ata_2025 IS
  'Controle até zerar saldo ata 2025 (Iris). Regras 1k e 50k só até zerar; depois competência=total do mês, baixa=0.';

GRANT SELECT ON view_controle_dividendos_ata_2025 TO anon;
GRANT SELECT ON view_controle_dividendos_ata_2025 TO service_role;
