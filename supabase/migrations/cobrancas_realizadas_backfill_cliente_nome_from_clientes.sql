-- Atualiza cobrancas_realizadas.cliente_nome com clientes.nome_fantasia,
-- casando apenas por cnpj_cpf (nome_fantasia é o mesmo em qualquer empresa).

UPDATE cobrancas_realizadas c
SET cliente_nome = sub.nome_fantasia
FROM (
  SELECT DISTINCT ON (cnpj_cpf) cnpj_cpf, nome_fantasia
  FROM clientes
  WHERE cnpj_cpf IS NOT NULL AND trim(cnpj_cpf) <> '' AND nome_fantasia IS NOT NULL
) sub
WHERE c.cnpj_cpf IS NOT NULL
  AND trim(c.cnpj_cpf) <> ''
  AND c.cnpj_cpf = sub.cnpj_cpf;
