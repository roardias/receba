-- Corrige &amp; e outras entidades HTML em clientes e categorias
-- Execute no Supabase SQL Editor (ou aplique como migration)

-- clientes: nome_fantasia e razao_social
UPDATE clientes
SET nome_fantasia = REPLACE(REPLACE(REPLACE(nome_fantasia, '&amp;', '&'), '&lt;', '<'), '&gt;', '>')
WHERE nome_fantasia LIKE '%&amp;%' OR nome_fantasia LIKE '%&lt;%' OR nome_fantasia LIKE '%&gt;%';

UPDATE clientes
SET razao_social = REPLACE(REPLACE(REPLACE(razao_social, '&amp;', '&'), '&lt;', '<'), '&gt;', '>')
WHERE razao_social LIKE '%&amp;%' OR razao_social LIKE '%&lt;%' OR razao_social LIKE '%&gt;%';

-- categorias: descricao
UPDATE categorias
SET descricao = REPLACE(REPLACE(REPLACE(descricao, '&amp;', '&'), '&lt;', '<'), '&gt;', '>')
WHERE descricao LIKE '%&amp;%' OR descricao LIKE '%&lt;%' OR descricao LIKE '%&gt;%';

-- OBRIGATÓRIO: atualizar a materialized view usada pelo dashboard
-- (a view guarda cache; sem REFRESH o dashboard continua mostrando dados antigos)
REFRESH MATERIALIZED VIEW CONCURRENTLY view_dashboard_receber;
