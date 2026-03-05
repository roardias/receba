-- Remove do início de cliente_nome o padrão "N - " (número + " - ").
-- Ex.: "1087 - M5 Seguranca Ltda" -> "M5 Seguranca Ltda".
-- Só atualiza linhas que batem no padrão e cujo resultado não fica vazio.

UPDATE cobrancas_realizadas
SET cliente_nome = trim(regexp_replace(cliente_nome, '^\d+\s*-\s*', ''))
WHERE cliente_nome ~ '^\d+\s*-\s*'
  AND trim(regexp_replace(cliente_nome, '^\d+\s*-\s*', '')) <> '';
