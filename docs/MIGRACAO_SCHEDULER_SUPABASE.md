# Migração: Scheduler 100% no Supabase (sem processo externo)

Este documento descreve a **nova** forma de agendamento (pg_cron + pg_net + Edge Functions) que roda **dentro do Supabase**, sem depender de Python 24/7, Railway, Render ou notebook. O método **atual** (Python `scheduler_sync.py`) permanece até a nova solução ser testada e aprovada.

---

## 1. Estado atual (o que NÃO mexemos até dar certo a nova solução)

### 1.1 O que continua funcionando como está

| Item | Descrição |
|------|-----------|
| **Tabela** | `api_agendamento` — grupos, empresas, dias_semana, horarios, api_tipos, ativo |
| **Frontend** | `frontend/src/app/configuracoes/agendamentos/page.tsx` — CRUD de agendamentos |
| **Scheduler Python** | `scheduler_sync.py` — loop a cada 60s, lê api_agendamento, enfileira jobs, processa empresa por empresa |
| **Syncs Python** | `sync_clientes_supabase.py`, `sync_categorias_supabase.py`, `sync_movimentos_supabase.py`, `sync_pagamentos_realizados_supabase.py`, `sync_recebimentos_supabase.py` |
| **Utilitários** | `utils/criptografia.py`, `scheduler_status.py`, `obter_empresas_para_sync` (em scheduler_sync e usado por sync_recebimentos) |
| **Deploy** | `DEPLOY.md`, `AGENDAMENTO_AUTOMATICO.md` — documentação do scheduler Python |
| **npm/package** | Scripts `npm run scheduler`, `npm run dev` (quando incluem o scheduler) |

### 1.2 Onde o scheduler Python é usado

- **Manual:** `python scheduler_sync.py` ou `npm run scheduler`
- **Produção:** Railway/Render/VPS ou Task Scheduler (Windows) rodando `python -u scheduler_sync.py`
- **sync_recebimentos_supabase.py** importa `obter_empresas_para_sync` e `_build_label_agendamento` de `scheduler_sync`

---

## 2. Nova arquitetura (estilo Lovable — tudo no Supabase)

### 2.1 Visão geral

```
api_agendamento (já existe)
    ↓ lido por
Edge Function: receba-sync-scheduler (chamada manual: botão "Configurar sincronização (Supabase)")
    ↓ remove crons antigos receba_sync_*
    ↓ expande grupos → empresas, monta lista (empresa_id, horário BR, dias, api_tipos)
    ↓ cria 1 job pg_cron por (empresa + horário UTC), com intervalo de 5 min entre empresas
    ↓ usa RPCs cron_schedule / cron_unschedule
pg_cron (N jobs)
    ↓ cada job executa
pg_net.http_post → Edge Function: receba-sync-empresa?empresa_id=XXX
    ↓ com header Authorization: Bearer SERVICE_ROLE_KEY
Edge Function: receba-sync-empresa
    ↓ lê credenciais da empresa (Supabase), descriptografa se necessário
    ↓ chama APIs Omie (categorias → clientes → movimentos → pagamentos → recebimentos conforme api_tipos)
    ↓ grava em clientes, categorias, movimentos, etc. e api_sync_log
```

- **Uma empresa por vez:** cada invocação da Edge Function processa **uma** empresa; os jobs são escalonados (ex.: 03:00, 03:05, 03:10) para não sobrecarregar o Omie.
- **Sem processo externo:** não é necessário Railway, Render, nem Python rodando 24/7.

### 2.2 Componentes novos (o que SERÁ CRIADO)

#### A. Supabase (migrations + extensões)

| Arquivo / Recurso | Descrição |
|-------------------|-----------|
| Extensões | `pg_cron`, `pg_net` (habilitar no projeto Supabase) |
| `supabase/migrations/YYYYMMDD_receba_cron_wrappers.sql` | RPCs `cron_schedule(job_name, schedule, command)` e `cron_unschedule(job_name)` com SECURITY DEFINER (wrapper sobre `cron.schedule` / `cron.unschedule`). Convenção de nome: `receba_sync_<empresa_id>_<dia>_<horario>` para poder remover só jobs do Receba. |
| (opcional) | Função SQL que lista agendamentos ativos e retorna (empresa_id, horario_utc, dias_semana, api_tipos) para a Edge Function consumir. Ou a Edge Function lê `api_agendamento` direto via Supabase client. |

#### B. Edge Functions (Supabase)

| Função | Descrição |
|--------|-----------|
| **receba-sync-scheduler** | Chamada manual (ou por botão no front). Lê `api_agendamento`, remove jobs `receba_sync_*`, expande grupos em empresas, gera N jobs pg_cron (1 por empresa por horário/dia), converte BR → UTC, chama `cron_schedule` para cada um. O `command` de cada job é um `pg_net.http_post` para a URL da Edge Function `receba-sync-empresa?empresa_id=...` com auth. |
| **receba-sync-empresa** | Recebe `empresa_id` (e opcionalmente `api_tipos` ou lê do agendamento). Busca empresa (app_key, app_secret), descriptografa se necessário, executa em ordem: categorias → clientes → movimentos → pagamentos_realizados → recebimentos_omie (conforme api_tipos do agendamento para essa empresa). Grava em tabelas existentes e em `api_sync_log`. Deve chamar `refresh_dashboard_receber_apos_acessorias` após clientes/movimentos quando aplicável. |

#### C. Frontend

| Alteração | Descrição |
|-----------|-----------|
| Botão em Agendamentos | Na página `configuracoes/agendamentos/page.tsx`, adicionar botão **"Configurar sincronização (Supabase)"** que chama a Edge Function `receba-sync-scheduler` (com service_role ou RPC que usa service_role). Texto de ajuda: "Ativa o agendamento automático usando apenas o Supabase (sem servidor externo). Execute após salvar ou editar agendamentos." |

#### D. Documentação

| Arquivo | Descrição |
|---------|-----------|
| `docs/MIGRACAO_SCHEDULER_SUPABASE.md` | Este arquivo: plano, o que criar, o que remover depois. |
| `docs/EDGE_FUNCTIONS_RECEBA_SYNC.md` | (opcional) Detalhes das Edge Functions, variáveis de ambiente (SUPABASE_URL, SERVICE_ROLE_KEY, ENCRYPTION_KEY nas secrets da função). |

### 2.3 O que NÃO é criado (reutilizamos)

- **api_agendamento** — já existe; a nova solução só lê e usa para montar os crons.
- **Tabelas de destino** (clientes, categorias, movimentos, api_sync_log, etc.) — inalteradas.
- **Lógica de negócio** — mesma ordem (categorias → clientes → movimentos → etc.) e mesma regra “uma empresa por vez”; apenas a implementação passa a ser em TypeScript nas Edge Functions (chamadas HTTP ao Omie e upsert no Supabase).

---

## 3. O que REMOVER ou DESATIVAR depois que a nova solução estiver aprovada

Quando os testes com pg_cron + Edge Functions estiverem estáveis e você quiser desligar o método antigo:

### 3.1 Código e scripts (pode apagar ou arquivar)

| Item | Ação sugerida |
|------|----------------|
| `scheduler_sync.py` | **Remover** ou mover para `_legacy/scheduler_sync.py` (e deixar de rodar em produção). |
| `sync_clientes_supabase.py` | Manter para uso manual/backup; o sync “automático” passa a ser pela Edge Function. Se quiser limpar: pode manter só para rodar via `python sync_clientes_supabase.py` localmente. |
| `sync_categorias_supabase.py` | Idem. |
| `sync_movimentos_supabase.py` | Idem. |
| `sync_pagamentos_realizados_supabase.py` | Idem. |
| `sync_recebimentos_supabase.py` | **Ajustar:** hoje importa `obter_empresas_para_sync` e `_build_label_agendamento` de `scheduler_sync`. Opções: (a) extrair `obter_empresas_para_sync` e `_build_label_agendamento` para um módulo `scheduler_utils.py` e usar em `sync_recebimentos_supabase.py`; ou (b) deixar de usar esse script para “agendamento” e usar só a Edge Function. |
| `scheduler_status.py` | Manter se outros scripts usam; senão pode remover. |
| `diagnostico_scheduler.py` | Pode manter como ferramenta de diagnóstico ou remover. |
| Scripts npm | Em `package.json` (raiz ou frontend): remover ou renomear `scheduler` / o script que inicia `scheduler_sync.py`. |

### 3.2 Documentação a atualizar

| Arquivo | Ação |
|---------|------|
| `DEPLOY.md` | Remover ou encurtar a seção "3. Scheduler (Python)"; explicar que o agendamento é feito pelo Supabase (pg_cron + Edge Functions) e que o botão "Configurar sincronização (Supabase)" aplica os agendamentos. |
| `AGENDAMENTO_AUTOMATICO.md` | Reescrever para descrever o fluxo Supabase (botão → receba-sync-scheduler → pg_cron → receba-sync-empresa); remover referências a `python scheduler_sync.py`, Railway, Render, Task Scheduler. |

### 3.3 Infraestrutura externa

| Item | Ação |
|------|------|
| Railway / Render / VPS | Parar o serviço que roda `python -u scheduler_sync.py` (ou desligar a máquina/task que o inicia). |
| Task Scheduler (Windows) | Desabilitar ou excluir a tarefa que inicia o scheduler Python. |

### 3.4 Checklist pós-migração (para você e para o assistente)

- [ ] Edge Functions `receba-sync-scheduler` e `receba-sync-empresa` deployadas e com secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ENCRYPTION_KEY).
- [ ] pg_cron e pg_net habilitados no projeto Supabase; migrations dos wrappers (`cron_schedule` / `cron_unschedule`) aplicadas.
- [ ] Botão "Configurar sincronização (Supabase)" testado: ao clicar, crons são criados; no horário agendado, a Edge Function por empresa é chamada e o sync roda.
- [ ] Logs em `api_sync_log` e dados em clientes/movimentos/etc. conferidos após um ciclo completo.
- [ ] Processo/serviço externo do scheduler Python desligado (Railway/Render/Task Scheduler).
- [ ] `scheduler_sync.py` removido ou movido para `_legacy`; `sync_recebimentos_supabase.py` ajustado se ainda importar de `scheduler_sync`.
- [ ] `DEPLOY.md` e `AGENDAMENTO_AUTOMATICO.md` atualizados conforme acima.
- [ ] Este documento (`docs/MIGRACAO_SCHEDULER_SUPABASE.md`) mantido como referência; seção "O que remover" pode ser marcada como concluída.

---

## 4. Ordem sugerida de implementação (sem apagar nada do que já funciona)

1. **Habilitar extensões e criar wrappers pg_cron**  
   Migration com `CREATE EXTENSION pg_cron;` (se permitido pelo Supabase), `pg_net`, e as RPCs `cron_schedule` / `cron_unschedule` com convenção de nome `receba_sync_*`.

2. **Criar Edge Function receba-sync-empresa**  
   Implementar sync de **uma** empresa (categorias → clientes → movimentos → pagamentos → recebimentos conforme api_tipos). Usar credenciais e ENCRYPTION_KEY das secrets; registrar em `api_sync_log` e chamar `refresh_dashboard_receber_apos_acessorias` quando fizer sentido.

3. **Criar Edge Function receba-sync-scheduler**  
   Ler `api_agendamento`, expandir grupos em empresas, remover crons `receba_sync_*`, criar um job por (empresa, horário/dia) com `pg_net.http_post` para `receba-sync-empresa?empresa_id=...`, horário em UTC.

4. **Frontend: botão "Configurar sincronização (Supabase)"**  
   Chamar a Edge Function `receba-sync-scheduler` (via fetch com service_role ou via RPC que chama a função).

5. **Testes**  
   Criar/editar agendamento, clicar no botão, verificar no Supabase que os jobs foram criados; aguardar um horário de teste e conferir logs e dados.

6. **Após validação**  
   Executar o checklist da seção 3.4 e remover/desativar apenas o que está listado na seção 3 (sem apagar nada antes de testar).

---

## 5. Referência rápida

- **Método antigo (atual):** `scheduler_sync.py` + sync_*.py em processo Python 24/7 (Railway/Render/notebook).
- **Método novo (alvo):** pg_cron + pg_net + Edge Functions `receba-sync-scheduler` e `receba-sync-empresa`; config em `api_agendamento`; botão no front chama o scheduler para aplicar os crons.
- **O que não apagar antes de testar:** todo o código e a doc listados na seção 1.
- **O que remover/ajustar depois:** seção 3 e checklist 3.4.

Documento criado para facilitar a migração e a remoção futura do método antigo. Qualquer alteração no plano deve ser refletida aqui.

---

## 6. Referência rápida (para você e para o assistente)

- **Onde está o plano completo:** `docs/MIGRACAO_SCHEDULER_SUPABASE.md` (este arquivo).
- **O que NÃO apagar agora:** tudo na seção 1 (scheduler_sync.py, sync_*.py, frontend agendamentos, api_agendamento).
- **O que vamos CRIAR:** seção 2.2 (migrations pg_cron, Edge Functions receba-sync-scheduler e receba-sync-empresa, botão no front).
- **O que REMOVER depois de testar:** seção 3 (scheduler_sync.py, ajuste em sync_recebimentos, doc DEPLOY/AGENDAMENTO, serviço externo).
- **Ordem de implementação:** seção 4 (cron wrappers → Edge Function receba-sync-empresa → receba-sync-scheduler → botão → testes → limpeza).
