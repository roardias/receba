# Scheduler: usar RPC para expandir grupos em empresas

Para que o botão **"Configurar sincronização (Supabase)"** crie jobs quando o agendamento for por **Grupo** (ex.: Alldax), a Edge Function **receba-sync-scheduler** deve usar a função SQL `receba_sync_agendamentos_expandidos` em vez de ler só `api_agendamento` e filtrar por `empresa_ids`.

## Código completo da Edge Function

**Arquivo no repositório:** `docs/receba-sync-scheduler-EDGE_FUNCTION_CODE.ts`

Abra esse arquivo, copie todo o conteúdo e cole no Supabase em: **Edge Functions → receba-sync-scheduler → abra o arquivo principal (index.ts) → substitua pelo código copiado → Deploy**.

Certifique-se de que as **Secrets** da função estão definidas no Supabase (Project Settings → Edge Functions → receba-sync-scheduler → Secrets):
- `SUPABASE_URL` (ex.: https://dyjoavuqrbtgimumhorp.supabase.co)
- `SUPABASE_SERVICE_ROLE_KEY`

---

## 1. Migration obrigatória

Aplique no Supabase (SQL Editor ou `supabase db push`) a migration:

- `supabase/migrations/receba_sync_agendamentos_expandidos.sql`

Ela cria a função `receba_sync_agendamentos_expandidos()` que retorna **uma linha por (empresa, agendamento)** já expandida: agendamentos por grupo viram várias linhas (uma por empresa do grupo).

## 2. Ajuste na Edge Function `receba-sync-scheduler`

**Antes:** a função lia `api_agendamento` e criava jobs apenas para linhas com `empresa_ids` não vazio, ignorando agendamentos só com `grupo_ids`.

**Depois:** usar a RPC que já faz a expansão:

1. Chamar `receba_cron_unschedule_all()` (igual hoje).
2. Em vez de ler `api_agendamento` e filtrar por `empresa_ids`, chamar a RPC:
   ```ts
   const { data: rows, error } = await supabase.rpc('receba_sync_agendamentos_expandidos');
   if (error) {
     return new Response(JSON.stringify({ error: error.message }), { status: 500 });
   }
   if (!rows?.length) {
     return new Response(JSON.stringify({ jobs_criados: 0 }), { status: 200 });
   }
   ```
3. Para **cada** `row` em `rows`, usar:
   - `row.empresa_id`
   - `row.dias_semana` (array, ex.: [1,2,3,4,5])
   - `row.horarios` (array, ex.: ["08:00", "20:55"])
   - `row.api_tipos` (se precisar passar para a Edge receba-sync-empresa)
   - `row.timezone` (ex.: "America/Sao_Paulo")
4. Para cada `(empresa_id, dia_semana, horario)` (produto cartesiano de dias × horários dessa linha), criar **um** job com `receba_cron_schedule`, com o `sql_block` fazendo `net.http_post` para:
   `https://<SUPABASE_URL>/functions/v1/receba-sync-empresa?empresa_id=<row.empresa_id>`
   no cron expression em UTC correspondente a esse dia + horário em `row.timezone`.
5. Contar o total de jobs criados e retornar `{ jobs_criados: N }`.

Assim, agendamentos por **Grupo** (ex.: Alldax) passam a gerar jobs para **todas as empresas** desse grupo, e o botão deixa de retornar "0 job(s) agendado(s)" quando só há grupo selecionado.

## 3. Resumo

| Situação                         | Sem RPC (antigo) | Com RPC (novo)      |
|----------------------------------|------------------|---------------------|
| Agendamento por **Empresa**      | Cria jobs        | Cria jobs           |
| Agendamento por **Grupo** (Alldax) | 0 jobs           | Cria 1 job por empresa do grupo |

Aplique a migration e atualize a Edge Function conforme acima para o comportamento correto.

---

## 4. Se ainda mostrar "0 job(s) agendado(s)"

1. **Rode o diagnóstico no Supabase**  
   Abra `docs/diagnostico_scheduler_supabase.sql`, copie e execute no **SQL Editor** do Supabase.  
   - Se a query `SELECT * FROM receba_sync_agendamentos_expandidos();` der **erro "function does not exist"** → aplique a migration `receba_sync_agendamentos_expandidos.sql` no SQL Editor.  
   - Se a RPC **retornar 0 linhas** → confira os agendamentos (query 1) e as empresas (query 3): `api_tipos` deve conter `clientes`, e empresas do grupo devem ter `ativo = true` e `grupo_id` preenchido.  
   - Se a RPC **retornar linhas** mas o botão ainda mostrar 0 jobs → a Edge Function no ar pode ser a antiga. Substitua todo o código da função pelo conteúdo de `docs/receba-sync-scheduler-EDGE_FUNCTION_CODE.ts`, faça deploy e teste de novo.

2. **Confirme a Edge Function**  
   No Supabase, em **Edge Functions → receba-sync-scheduler**, o código deve usar **`supabase.rpc('receba_sync_agendamentos_expandidos')`** (e não ler só a tabela `api_agendamento`). Use exatamente o arquivo `receba-sync-scheduler-EDGE_FUNCTION_CODE.ts`.
