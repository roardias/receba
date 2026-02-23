-- Diagnóstico: código 1061 não puxa grupo na view mas existe em clientes e acessorias
-- Execute no SQL Editor do Supabase para validar.

-- 1) Existe em acessorias com id_planilha = '1061'?
SELECT 'acessorias' AS origem, id, id_planilha, grupo_empresas, razao_social, tag_top_40
FROM acessorias
WHERE id_planilha = '1061';

-- 2) Clientes com codigo_nome_fantasia = '1061' (e se acessoria_id está preenchido)
SELECT 'clientes' AS origem, chave_unica, nome_fantasia, codigo_nome_fantasia, acessoria_id
FROM clientes
WHERE codigo_nome_fantasia = '1061';

-- 3) Comparação: mesmo código, lado a lado (clientes x acessorias)
SELECT
  c.chave_unica,
  c.nome_fantasia,
  c.codigo_nome_fantasia AS cod_cliente,
  c.acessoria_id,
  a.id_planilha AS id_planilha_acessoria,
  a.grupo_empresas,
  a.tag_top_40,
  CASE WHEN c.acessoria_id IS NULL THEN 'NULL (por isso perde grupo na view)' ELSE 'OK' END AS motivo
FROM clientes c
LEFT JOIN acessorias a ON a.id_planilha = c.codigo_nome_fantasia
WHERE c.codigo_nome_fantasia = '1061';

-- 4) O que a view atual retornaria para movimentos desse cliente (antes do fix)
-- (requer view_dashboard_receber já existente)
SELECT movimento_id, nome_fantasia, codigo_nome_fantasia, grupo_empresas, tag_top_40
FROM view_dashboard_receber
WHERE codigo_nome_fantasia = '1061'
LIMIT 5;
