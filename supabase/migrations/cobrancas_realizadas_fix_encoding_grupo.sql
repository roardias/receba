-- Corrige valor de grupo_nome com encoding quebrado: Manã‰ (ou variante) -> Mané
-- O valor exato no banco pode variar por encoding; atualiza qualquer grupo "Man" + 2 caracteres (5 no total) que não seja já "Mané".

UPDATE cobrancas_realizadas
SET grupo_nome = 'Mané'
WHERE grupo_nome LIKE 'Man%'
  AND length(grupo_nome) = 5
  AND grupo_nome <> 'Mané';
