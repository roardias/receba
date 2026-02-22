-- Inativar usuário (cadastro): adm/gerente podem setar ativo = false
ALTER TABLE perfis
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN perfis.ativo IS 'Se false, usuário inativo e não pode acessar o sistema.';
