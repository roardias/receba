# Colocando o Receba online

O sistema tem **três partes**:

1. **Banco e autenticação** → Supabase (já é na nuvem)
2. **Site (frontend)** → hospedagem Next.js (recomendado: **Vercel**)
3. **Scheduler (sincronização Omie)** → um processo Python rodando 24/7 (recomendado: **Railway** ou **Render**)

---

## 1. Supabase (banco e auth)

O Supabase já é um serviço online. Você só precisa:

1. Acessar [supabase.com](https://supabase.com) e criar um projeto (ou usar o que já tem).
2. Em **Project Settings → API** anotar:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_KEY` (scheduler)
   - **service_role** (secret) → `SUPABASE_SERVICE_ROLE_KEY` (só no frontend, para admin de usuários)
3. **Migrations (tabelas e views):** Se as tabelas, views e triggers já foram criados no seu projeto Supabase (migrations já rodadas), pode pular este passo. Caso contrário: **SQL Editor** → executar cada arquivo em `supabase/migrations/` **na ordem do nome** (ou usar `supabase db push` com a CLI).

Depois disso, o “backend” (dados + auth) já está online.

---

## 2. Frontend (site Next.js) – onde hospedar

### Opção recomendada: **Vercel**

- Feito pelos criadores do Next.js, integra muito bem.
- Plano gratuito suficiente para começar.
- Deploy automático ao dar push no GitHub.

**Passos:**

1. Crie uma conta em [vercel.com](https://vercel.com) e conecte seu repositório GitHub (ou faça upload do projeto).
2. **Importante:** Configure o **Root Directory**:
   - Em **Settings** → **General** → **Root Directory** → **Edit** → digite **`frontend`** → **Save**.
   - Sem isso o Vercel procura o Next.js na raiz do repo e falha com "No Next.js version detected".
   - Build Command: `npm run build` (padrão). Output: Next.js (padrão).
3. Em **Settings → Environment Variables** adicione (para Production e Preview):

   | Nome | Valor |
   |------|--------|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave anon do Supabase |
   | `SUPABASE_SERVICE_ROLE_KEY` | Chave service_role (para admin de usuários) |
   | `ENCRYPTION_KEY` | **Obrigatório para e-mail.** Mesmo valor do `.env` local (copie e cole). Usada para descriptografar o Client Secret do Microsoft 365. Se faltar, ao enviar e-mail aparece erro de descriptografia. |

4. Faça o deploy. A Vercel vai gerar uma URL tipo `seu-projeto.vercel.app`.

**Outras opções:**

- **Netlify** – também suporta Next.js; configurar root em `frontend` e variáveis de ambiente.
- **Railway** ou **Render** – se quiser frontend e scheduler no mesmo lugar; configurar como “Web Service” apontando para a pasta `frontend` e comando `npm run build && npm run start`.

---

## 3. Scheduler (Python – sincronização Omie)

O `scheduler_sync.py` precisa rodar o tempo todo para executar os agendamentos de sync (clientes, movimentos, pagamentos etc.). Duas boas opções:

### Opção A: **Railway** (recomendada)

- Suporta Python e processo contínuo.
- Plano gratuito com limite de uso.

**Passos:**

1. Crie conta em [railway.app](https://railway.app) e um novo projeto.
2. Conecte o repositório GitHub (ou faça deploy do código).
3. Adicione um **service** e configure:
   - **Root Directory:** raiz do projeto (onde está `scheduler_sync.py`, `sync_*.py`, `utils/`, etc.).
   - **Build Command:** algo como `pip install -r requirements.txt` (crie um `requirements.txt` na raiz com as dependências do scheduler).
   - **Start Command:** `python -u scheduler_sync.py`
4. Em **Variables** defina:
   - `SUPABASE_URL`
   - `SUPABASE_KEY` (pode ser service_role para o scheduler ter permissão)
   - `ENCRYPTION_KEY` (igual à do frontend, para descriptografar app_secret das empresas)

Assim o scheduler fica online 24/7.

### Opção B: **Render**

- [render.com](https://render.com) → **Background Worker**.
- Configurar repositório, comando de start `python -u scheduler_sync.py`, e as mesmas variáveis de ambiente.

### Opção C: VPS (DigitalOcean, Contabo, etc.)

- Em um servidor Linux, use `systemd` ou `screen`/`tmux` para rodar `python -u scheduler_sync.py` em background.
- Útil se quiser tudo (ou outros scripts) no mesmo servidor.

---

## Resumo rápido

| Parte | Onde | Ação |
|-------|------|------|
| Banco + Auth | **Supabase** | Criar projeto, rodar migrations, pegar URL e chaves |
| Site (Next.js) | **Vercel** | Conectar repo, root `frontend`, configurar variáveis, deploy |
| Scheduler Python | **Railway** ou **Render** | Deploy do código, comando `python -u scheduler_sync.py`, variáveis SUPABASE + ENCRYPTION_KEY |

Depois disso, o sistema fica acessível pela URL da Vercel, os dados no Supabase e as sincronizações Omie rodando pelo scheduler.

---

## Checklist antes de subir

- [ ] Migrations do Supabase executadas na ordem
- [ ] Variáveis de ambiente do frontend (Vercel) preenchidas
- [ ] Variáveis do scheduler (Railway/Render) preenchidas
- [ ] `ENCRYPTION_KEY` **no Vercel** igual à do `.env` local (obrigatório para envio de e-mail)
- [ ] Se usar domínio próprio: configurar na Vercel e, se quiser, no Supabase (Auth URL permitidas)

### Erro "Não foi possível descriptografar o Client Secret"

1. No **Vercel** → seu projeto → **Settings** → **Environment Variables**.
2. Adicione (ou edite) **ENCRYPTION_KEY** com **exatamente** o mesmo valor que está no seu arquivo `.env` local (a linha `ENCRYPTION_KEY=...`).
3. Faça um **Redeploy** (Deployments → ⋯ no último deploy → Redeploy) para as variáveis atualizadas valerem.
4. Se o Client Secret foi salvo no ambiente local com uma chave, use essa mesma chave no Vercel. Se trocar a chave, será preciso editar a configuração de e-mail e salvar o Client Secret de novo (criptografado com a nova chave).

Se quiser, posso te ajudar a montar o `requirements.txt` do scheduler ou a lista exata de variáveis para cada serviço.
