-- Controle: dividendos ata 2025 (Iris) x pagamentos por empresa.
-- Objetivo: zerar o saldo da ata. O controle por competência/baixa vale só até zerar; depois de zerar não há mais controle.
-- Saldo inicial em jan/26 = valor_ata. Regras até zerar:
--   Regra 1.000: valor_ata = 1.000 → baixa parcial (min(pagamento, saldo)) até zerar.
--   Regra 50k: pagamento > 50k e saldo > 50k → competência 50k, baixa = min(pagamento-50k, saldo); senão baixa = saldo (zerar).
-- Saldo zerado: meses seguintes → competência = total do mês, baixa = 0 (não há ata para baixar).

-- UUID da empresa Iris (dividendos ata 2025)
-- ALTER para o id correto se necessário.

-- View: traz todos de dividendos_ata_2025 (Iris); quem não tem pagamento jan/26+ aparece com linha jan/26 zerada
-- DROP antes de CREATE para permitir adicionar/alterar colunas (CREATE OR REPLACE não muda ordem de colunas)
DROP VIEW IF EXISTS view_controle_dividendos_ata_2025;
CREATE VIEW view_controle_dividendos_ata_2025 AS
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
-- Apenas pagamentos da empresa Iris (dividendos ata são só da Iris)
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
-- Quem está na ata mas não tem nenhuma linha de pagamento Iris em jan/26 ou depois (inclui quem só tem pagamento em 2025)
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
-- União: todos os pagamentos Iris + uma linha jan/26 para quem não tem nenhum a partir de jan/26
detalhe_completo AS (
  SELECT empresa_pagamento, empresa_razao_social, empresa_cnpj, cpf, nome, ano, mes, valor_pago FROM detalhe
  UNION ALL
  SELECT empresa_pagamento, empresa_razao_social, empresa_cnpj, cpf, nome, ano, mes, valor_pago FROM sem_linha_jan26
),
-- Total pago por (cpf, ano, mes) — apenas a partir de jan/26 (saldo inicial começa nesse mês)
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
-- Ordenar meses para recursão
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
-- Saldo ata mês a mês (recursivo): regra 1.000 (baixa parcial até zerar) e regra 50k (competência 50k se saldo > 50k, senão baixa limitada a zerar)
rec AS (
  -- Anchor: primeiro mês (rn=1), saldo_inicial = valor_ata
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
  -- Recursive: meses seguintes; se saldo já zerado → só competência (total do mês), sem baixa ata
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
-- Totais e saldos por (cpf, ano, mes)
controle_mes AS (
  SELECT cpf, nome, ano, mes, total_pago_mes, saldo_ata_inicial, competencia_mes, baixa_ata_mes, saldo_ata_final
  FROM rec
)
-- Só exibe meses em que ainda há saldo para controlar (saldo_ata_inicial > 0). Após zerar, não mostra meses seguintes.
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
