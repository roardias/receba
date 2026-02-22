-- Preenche grupo_id a partir da empresa vinculada quando grupo_nome não deu match com grupos.nome
-- (ex.: grupo_nome "-" ou "Quality" não existe em grupos; empresa "Alldax 1" já tem empresa_id e pertence a um grupo)

UPDATE cobrancas_realizadas c
SET grupo_id = e.grupo_id
FROM empresas e
WHERE c.empresa_id = e.id
  AND c.grupo_id IS NULL
  AND e.grupo_id IS NOT NULL;
