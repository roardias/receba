-- Normaliza nomes em cobrancas_realizadas: primeira letra de cada palavra maiúscula, demais minúsculas.
-- initcap() no PostgreSQL faz exatamente isso (respeitando acentos).

UPDATE cobrancas_realizadas
SET
  cliente_nome            = initcap(cliente_nome),
  grupo_nome               = initcap(grupo_nome),
  empresas_internas_nomes   = initcap(empresas_internas_nomes),
  nome_pessoa              = initcap(nome_pessoa),
  cargo_pessoa             = initcap(cargo_pessoa),
  nome_quem_conversou      = initcap(nome_quem_conversou),
  cargo_quem_conversou     = initcap(cargo_quem_conversou);
