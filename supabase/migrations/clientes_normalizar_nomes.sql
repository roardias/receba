-- Normaliza razao_social e nome_fantasia em clientes: primeira letra de cada palavra maiúscula, demais minúsculas (INITCAP).
UPDATE clientes
SET razao_social = INITCAP(TRIM(COALESCE(razao_social, '')))
WHERE TRIM(COALESCE(razao_social, '')) != '';

UPDATE clientes
SET nome_fantasia = INITCAP(TRIM(COALESCE(nome_fantasia, '')))
WHERE TRIM(COALESCE(nome_fantasia, '')) != '';

COMMENT ON COLUMN clientes.razao_social IS 'Razão social (exibição normalizada: INITCAP).';
COMMENT ON COLUMN clientes.nome_fantasia IS 'Nome fantasia (exibição normalizada: INITCAP).';
