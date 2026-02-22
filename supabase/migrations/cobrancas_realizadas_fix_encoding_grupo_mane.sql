-- Corrige grupo_nome com encoding quebrado (ex.: Manã‰) -> Mané
-- Atualiza qualquer valor que comece com "Man" e tenha 5 caracteres e ainda não seja "Mané".

UPDATE cobrancas_realizadas
SET grupo_nome = 'Mané'
WHERE grupo_nome LIKE 'Man%'
  AND length(grupo_nome) = 5
  AND grupo_nome <> 'Mané';
