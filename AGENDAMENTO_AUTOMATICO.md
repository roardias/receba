# Disparo automático - Scheduler

O `scheduler_sync.py` verifica a cada 30 segundos se há agendamentos para executar no horário atual (UTC-3, Brasília).

## Como funciona

1. Lê a tabela `api_agendamento` (configurada no frontend)
2. Compara: dia da semana atual + horário atual (ex.: Seg 08:00)
3. **Coalesce**: se vários agendamentos apontam para o mesmo grupo/empresas, vira 1 job só (evita rodar clientes/categorias/movimentos em duplicata)
4. **Cooldown**: não re-dispara o mesmo grupo/empresas em menos de 15 min (evita loop quando há vários horários seguidos)
5. Para cada job, executa na ordem: clientes → categorias → movimento_financeiro
6. Grava logs em `api_sync_log`

## Executar

> **Primeira vez**: rode `npm install` na pasta `frontend/` antes.

### Desenvolvimento local (servidor + scheduler juntos)

Na pasta raiz do projeto (`Receba`):

```bash
npm run dev
```

Sobe o Next.js e o scheduler ao mesmo tempo. Use no dia a dia dos testes.

### Apenas o scheduler (produção ou teste isolado)

```bash
npm run scheduler
# ou
python scheduler_sync.py
```

O script fica rodando em loop. Use **Ctrl+C** para parar.

### Produção no servidor (servidor + scheduler juntos)

```bash
npm run start
```

Roda Next.js em modo produção e o scheduler em paralelo.

## Manter rodando 24h no servidor

### Opção 1: Servidor Linux (systemd) – recomendado para produção
1. Edite `scheduler.service` e ajuste `WorkingDirectory`, `EnvironmentFile` e `User` para o seu servidor.
2. Copie para o systemd e ative:

```bash
sudo cp scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable scheduler   # inicia ao boot do servidor
sudo systemctl start scheduler    # inicia agora
sudo systemctl status scheduler   # verifica status
```

O scheduler sobe automaticamente quando o servidor reinicia.

### Opção 2: Windows Task Scheduler (desenvolvimento local)
1. Abra "Agendador de Tarefas"
2. Criar Tarefa Básica
3. Disparador: "Quando o computador iniciar"
4. Ação: Iniciar um programa
5. Programa: `python`
6. Argumentos: `scheduler_sync.py`
7. Iniciar em: `c:\Programas criados por Rodrigo\Receba`

### Opção 3: Servidor/cloud (Railway, Render, etc.)
Configure um **Worker** ou **Process** separado do frontend. Comando de início:

```bash
python scheduler_sync.py
```

O serviço mantém o processo ativo e o reinicia em caso de queda.

### Opção 4: Docker
Use a imagem Python e rode o scheduler como comando principal. O container reinicia automaticamente se configurar `restart: unless-stopped`.

## Pré-requisitos

- Empresas cadastradas no frontend com **app_key** e **app_secret** preenchidos
- Agendamentos criados em Configurações > Agendamentos API
- `.env` com SUPABASE_URL, SUPABASE_KEY, ENCRYPTION_KEY
