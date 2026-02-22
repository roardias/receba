-- Perfis de usuário (vinculado ao auth.users do Supabase)
-- Roles: adm, gerencia, usuario
-- Senha padrão: primeiros 6 caracteres do primeiro nome. Ao primeiro login, alteração obrigatória.

CREATE TABLE IF NOT EXISTS perfis (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('adm', 'gerencia', 'usuario')),
  primeiro_login BOOLEAN NOT NULL DEFAULT true,
  nome TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perfis_role ON perfis(role);

ALTER TABLE perfis ENABLE ROW LEVEL SECURITY;

-- Usuário só acessa o próprio perfil
CREATE POLICY "Usuário vê e atualiza próprio perfil"
  ON perfis FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Inserção permitida apenas para o próprio id (criação no primeiro login)
CREATE POLICY "Usuário pode inserir próprio perfil"
  ON perfis FOR INSERT
  WITH CHECK (auth.uid() = id);

COMMENT ON TABLE perfis IS 'Perfil e permissões. Senha padrão = primeiros 6 caracteres do primeiro nome. Primeiro login exige troca de senha.';
