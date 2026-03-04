# Rodar o Receba na VPS igual à sua máquina

Quando você usa **`npm run dev`** na sua máquina, duas coisas ficam rodando ao mesmo tempo:

1. **Next.js** — o site e as APIs (dashboard, agendamentos, etc.)
2. **Scheduler Python** — o script que a cada 1 minuto lê os agendamentos no Supabase e executa a sincronização Omie (clientes, movimentos, etc.)

Na sua máquina isso funciona porque **o mesmo ambiente** (mesmo `.env`, mesma rede) é usado pelos dois. Na VPS você pode fazer **exatamente isso**: rodar o Next.js em modo produção **e** o scheduler Python no mesmo servidor, com as mesmas variáveis de ambiente. Assim o comportamento é idêntico ao da sua máquina.

---

## Comparação rápida

| Onde | O que roda | Quem faz o sync |
|------|------------|-----------------|
| **Sua máquina (npm run dev)** | Next.js + Python scheduler (juntos) | **Python** (scheduler_sync.py) lê `api_agendamento` e roda os scripts de sync (clientes, movimentos, etc.) |
| **VPS com cron + Vercel (modo antigo)** | Só um cron na VPS chamando a URL da Vercel | **API na Vercel** chama a Edge Function do Supabase; outro código, outro ambiente → pode dar diferença (ex.: dados atrasados) |
| **VPS igual à máquina (este guia)** | Next.js + Python scheduler na VPS | **Python** (o mesmo scheduler_sync.py), mesmo código que na sua máquina |

Este guia configura a **terceira linha**: VPS rodando Next.js + Python scheduler, igual à sua máquina.

---

## O que você vai precisar

- Acesso **SSH** à VPS (Localweb ou outro provedor).
- O mesmo **.env** que você usa na sua máquina (raiz do projeto e `frontend/.env.local`), para copiar para a VPS.
- Node.js 18+ e Python 3.10+ na VPS (instalação abaixo).

---

## Passo a passo na VPS

### 1. Conectar na VPS

No PowerShell (Windows), com a chave SSH que você já usa:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_receba" root@IP_DO_SERVIDOR
```

(Substitua `root` e `IP_DO_SERVIDOR` conforme o que a Localweb informou.)

---

### 2. Instalar Node.js e Python (se ainda não tiver)

Na VPS (Linux), depois de conectado:

```bash
# Node.js 20 (exemplo para Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Python 3 e pip
sudo apt-get update
sudo apt-get install -y python3 python3-pip python3-venv
```

Confira:

```bash
node -v   # deve ser v18 ou v20
python3 --version
```

---

### 3. Clonar o projeto e instalar dependências

```bash
# Exemplo: clone na pasta home do usuário
cd ~
git clone https://github.com/SEU_USUARIO/Receba.git
cd Receba
```

(Substitua pela URL real do seu repositório.)

**Dependências Node (raiz e frontend):**

```bash
npm install
cd frontend && npm install && cd ..
```

**Dependências Python:**

```bash
pip3 install -r requirements.txt
```

(Se der erro de permissão, use: `pip3 install --user -r requirements.txt`.)

---

### 4. Configurar variáveis de ambiente (igual à sua máquina)

Na **sua máquina**, você tem:

- Na **raiz do projeto**: arquivo **`.env`** (com `ENCRYPTION_KEY`, e às vezes `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`).
- Na pasta **frontend**: arquivo **`frontend/.env.local`** (com `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ENCRYPTION_KEY`, etc.).

Na **VPS**, crie os mesmos arquivos com os **mesmos valores**. Nunca commite esses arquivos no Git (eles já devem estar no `.gitignore`).

**Opção A — Copiar os arquivos da sua máquina para a VPS**

Na sua máquina (PowerShell), a partir da pasta do projeto:

```powershell
scp -i "$env:USERPROFILE\.ssh\id_ed25519_receba" .env root@IP_DO_SERVIDOR:~/Receba/
scp -i "$env:USERPROFILE\.ssh\id_ed25519_receba" frontend/.env.local root@IP_DO_SERVIDOR:~/Receba/frontend/
```

**Opção B — Criar na mão na VPS**

Conectado na VPS:

```bash
cd ~/Receba
nano .env
```

Coloque pelo menos (valores iguais aos da sua máquina):

```env
ENCRYPTION_KEY=sua_chave_aqui
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Salve (Ctrl+O, Enter, Ctrl+X). Depois:

```bash
nano frontend/.env.local
```

Coloque:

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ENCRYPTION_KEY=sua_chave_aqui
```

A **ENCRYPTION_KEY** deve ser **exatamente a mesma** no `.env` da raiz e no `frontend/.env.local`.

Resumo das variáveis que o scheduler e o Next.js usam:

| Variável | Onde | Obrigatório para |
|----------|------|-------------------|
| `ENCRYPTION_KEY` | .env (raiz) e frontend/.env.local | Criptografia de secrets; scheduler e API |
| `SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_URL` | .env e/ou frontend/.env.local | Scheduler e Next.js |
| `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_KEY`) | .env e/ou frontend/.env.local | Scheduler e Next.js (RLS) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | frontend/.env.local | Next.js (auth no browser) |

---

### 5. Build do Next.js

Na VPS, na raiz do projeto:

```bash
cd ~/Receba
npm run build
```

Isso faz o build do frontend (Next.js). Pode levar alguns minutos.

---

### 6. Rodar Next.js + Scheduler 24/7 (com PM2)

Para os dois processos ficarem rodando igual na sua máquina (e reiniciarem se cair), use o **PM2**.

**Instalar PM2 (uma vez):**

```bash
sudo npm install -g pm2
```

**Subir o Receba (Next.js + scheduler Python):**

Na raiz do projeto:

```bash
cd ~/Receba
pm2 start ecosystem.config.js
```

O arquivo `ecosystem.config.js` na raiz do projeto já está configurado para:

- **next** — Next.js em modo produção (`npm run start` no frontend).
- **scheduler** — Python `scheduler_sync.py` (o mesmo que roda com `npm run dev` na sua máquina).

**Comandos úteis:**

```bash
pm2 status          # ver se os dois estão “online”
pm2 logs            # ver logs dos dois (Ctrl+C para sair)
pm2 logs scheduler  # só logs do scheduler Python
pm2 logs next       # só logs do Next.js
pm2 restart all     # reiniciar os dois
pm2 stop all        # parar os dois
```

**Para o PM2 iniciar sozinho quando a VPS reiniciar:**

```bash
pm2 startup
```

(Siga a mensagem que aparecer; em geral copia e cola o comando que ele sugerir.)

Depois:

```bash
pm2 save
```

Assim, após um reboot da VPS, o Next.js e o scheduler voltam a subir sozinhos.

---

### 7. Testar

- **Site:** abra no navegador: `http://IP_DA_VPS:3000` (ou o domínio que você apontar para a VPS). Deve abrir o Receba.
- **Scheduler:** nos logs deve aparecer a mensagem de que o scheduler está verificando a cada 60s:

```bash
pm2 logs scheduler
```

Você deve ver linhas como “Scheduler iniciado. Verificando agendamentos a cada 60s (UTC-3).” e, nos horários configurados em **Agendamentos**, as execuções dos syncs.

---

### 8. Resumo

| Passo | O quê |
|-------|--------|
| 1 | Conectar na VPS por SSH |
| 2 | Instalar Node.js 18+ e Python 3.10+ |
| 3 | Clonar o repositório e rodar `npm install` (raiz + frontend) e `pip3 install -r requirements.txt` |
| 4 | Copiar/criar `.env` (raiz) e `frontend/.env.local` com os mesmos valores da sua máquina |
| 5 | Rodar `npm run build` na raiz |
| 6 | Instalar PM2 e rodar `pm2 start ecosystem.config.js` |
| 7 | Rodar `pm2 startup` e `pm2 save` para manter tudo rodando após reinício da VPS |

Assim, o que roda na VPS fica **igual** ao que roda na sua máquina com `npm run dev`: mesmo Next.js, mesmo scheduler Python e mesmas variáveis de ambiente.

---

## Se você ainda quiser usar cron + Vercel

Se preferir **não** rodar o Next.js na VPS e continuar com o site na Vercel e só um cron na VPS chamando a API da Vercel, use o outro guia: [RODAR_SCHEDULER_NA_VPS.md](./RODAR_SCHEDULER_NA_VPS.md). Nesse modo o sync é feito pela **Edge Function** do Supabase (fluxo diferente do Python da sua máquina). O guia “igual à máquina” acima evita essa diferença.
