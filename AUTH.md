# Autenticação e primeiro usuário

## Senha padrão

A **primeira senha** de cada usuário deve ser os **primeiros 6 caracteres do primeiro nome** (ex.: Rodrigo → `Rodrig`).

## Primeiro login

No primeiro acesso, o sistema exige **alteração obrigatória da senha**. O usuário é redirecionado para a tela "Alterar senha" e só pode usar o restante do sistema após definir uma nova senha.

## Como criar o primeiro usuário (admin)

1. No **Supabase**: Authentication → Users → **Add user** → informe e-mail e senha.
2. Use como senha os **primeiros 6 caracteres do primeiro nome** (ex.: `Rodrig`).
3. Após o primeiro login no Receba, o perfil é criado automaticamente com role `usuario`.
4. Para tornar esse usuário **administrador**, no Supabase (SQL Editor) execute:

```sql
UPDATE perfis SET role = 'adm' WHERE id = 'UUID_DO_USUARIO';
```

(O UUID está em Authentication → Users → clique no usuário.)

## Roles

- **adm** – Administrador
- **gerencia** – Gerência
- **usuario** – Usuário padrão

As permissões granulares por tela/cadastro serão definidas quando o controle por usuário for expandido.
