# Credenciais Omie – fluxo e configuração

## Visão geral

O admin cadastra **App Key** e **App Secret** da Omie apenas no **frontend** (Configurações → Empresas). Nada precisa ser alterado direto no banco.

## Fluxo

1. **Admin** preenche o formulário de empresas no frontend (App Key e App Secret).
2. **Frontend** envia o App Secret para `/api/criptografar`, recebe o valor criptografado e grava no Supabase:
   - `app_secret` (texto) – usado pelo scheduler direto, sem depender de chave de criptografia.
   - `app_secret_encrypted` – cópia criptografada (backup/consistência).
3. **Scheduler** (e demais scripts de sync) leem a tabela `empresas`:
   - Se `app_secret` (texto) estiver preenchido → usa esse valor.
   - Se não, usa `descriptografar(app_secret_encrypted)` com a `ENCRYPTION_KEY` do ambiente.

## Configuração para funcionar sem intervenção manual

### 1. Uma única chave de criptografia

- **Raiz do projeto:** no `.env` defina `ENCRYPTION_KEY` (ex.: chave Fernet ou senha).
- **Frontend:** no `frontend/.env.local` use a **mesma** `ENCRYPTION_KEY` (copie do `.env` da raiz).

Assim, o que o frontend criptografa pode ser descriptografado pelo scheduler quando precisar usar `app_secret_encrypted`.

### 2. Scheduler

- Carrega primeiro o `.env` da **raiz** e depois o `frontend/.env.local` **sem** sobrescrever variáveis já definidas.
- Ou seja, a `ENCRYPTION_KEY` que vale para o scheduler é sempre a do **.env da raiz**.

### 3. Boas práticas

- Manter a mesma `ENCRYPTION_KEY` no `.env` (raiz) e no `frontend/.env.local`.
- Não editar `app_secret` / `app_secret_encrypted` direto no banco; usar sempre a tela de Configurações → Empresas.
- Ao editar uma empresa e não alterar o App Secret, deixar o campo em branco ("Deixe vazio para manter") para não sobrescrever o valor atual.

## Resumo

| Onde        | O que fazer |
|------------|-------------|
| Frontend   | Cadastrar/editar empresas com App Key e App Secret. |
| .env (raiz)| Definir `ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. |
| frontend/.env.local | Colocar a **mesma** `ENCRYPTION_KEY` do .env da raiz. |
| Banco      | Não alterar credenciais manualmente; usar só o frontend. |

Com isso, o sistema fica escalável e sem necessidade de correção manual no banco.

---

## Criptografia não funciona (403 em todas as empresas)

**Sintoma:** Logs da API mostram 403 Forbidden para várias empresas; só funciona quem tem `app_secret` em texto no banco.

**Causa:** O valor em `app_secret_encrypted` foi criptografado com outra `ENCRYPTION_KEY` (ex.: frontend tinha chave diferente no passado). O scheduler usa a chave do `.env` da raiz para descriptografar; se não bater, o secret fica errado e a Omie retorna 403.

**O que fazer (uma vez):**

1. **Unificar a chave**
   - No `.env` da raiz do projeto está `ENCRYPTION_KEY=...`
   - Copie **esse valor inteiro** para o `frontend/.env.local` (linha `ENCRYPTION_KEY=...`).
   - Reinicie o frontend e o scheduler.

2. **Confirmar que as chaves são iguais**
   - Rode no projeto: `python verificar_criptografia.py`
   - No navegador (com o frontend rodando): `http://localhost:3000/api/verificar-chave`
   - O prefixo da chave (ex.: `cjXX...tI=`) deve ser igual nos dois.

3. **Re-salvar o App Secret de cada empresa**
   - Em **Configurações → Empresas**, edite cada empresa que está com erro.
   - Cole de novo o **App Secret** da Omie e clique em **Atualizar**.
   - Assim o frontend grava de novo `app_secret` (texto) e `app_secret_encrypted` (com a chave atual). O scheduler passa a usar o texto ou a descriptografar corretamente.
