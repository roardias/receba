-- Corrige grupo_nome "Manã‰" (encoding quebrado) -> "Mané".
-- Critério: começa com "Man", não é "Mané", e tem 4 a 6 caracteres (pega o mojibake em qualquer encoding).

UPDATE cobrancas_realizadas
SET grupo_nome = 'Mané'
WHERE grupo_nome LIKE 'Man%'
  AND grupo_nome <> 'Mané'
  AND length(grupo_nome) BETWEEN 4 AND 5;
