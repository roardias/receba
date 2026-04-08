# Edge Function receba-sync-empresa: incluir Movimentos Geral

O agendamento dispara via **Vercel Cron** → `GET /api/scheduler/run` → **Edge Function** `receba-sync-empresa`.  
Para o tipo **"Movimentos Geral (Títulos pagos / Títulos a vencer)"** ser executado, a Edge no Supabase precisa tratar `movimentos_geral` na **mesma estrutura** dos demais (`clientes`, `categorias`, `movimento_financeiro`, etc.).

O frontend já envia **`api_tipos`** na URL da Edge (ex.: `?empresa_id=xxx&api_tipos=clientes,movimentos_geral`). A Edge deve ler esse parâmetro e executar só os tipos recebidos.

---

## 1. Onde a Edge é chamada (Vercel)

- **Arquivo:** `frontend/src/app/api/scheduler/run/route.ts`
- **URL:** `GET /api/scheduler/run` (protegido por `CRON_SECRET_KEY` ou `?secret=...`)
- **Chamada à Edge:**  
  `GET <SUPABASE_URL>/functions/v1/receba-sync-empresa?empresa_id=<uuid>&api_tipos=clientes,movimentos_geral,...`

Se o agendamento tiver "Movimentos Geral" marcado, `movimentos_geral` virá em `api_tipos`. A Edge **precisa** reconhecer e executar esse tipo.

---

## 2. Alterações na Edge Function receba-sync-empresa (Supabase)

No código da Edge **no Supabase** (Edge Functions → receba-sync-empresa → index.ts):

### 2.1) Ler `api_tipos` da query string

Ao tratar o request, leia os query params:

```ts
const url = new URL(req.url);
const empresaId = url.searchParams.get("empresa_id");
const apiTiposParam = url.searchParams.get("api_tipos"); // "clientes,movimentos_geral,..."
const api_tipos: string[] = apiTiposParam
  ? apiTiposParam.split(",").map((t) => t.trim()).filter(Boolean)
  : []; // se vazio, pode usar fallback (ex.: ler agendamentos e calcular)
```

### 2.2) Lista de tipos aceitos

Onde a Edge define quais tipos pode executar (validação ou filtro), inclua **`movimentos_geral`**:

```ts
const TIPOS_ACEITOS = [
  "clientes",
  "categorias",
  "movimento_financeiro",
  "movimentos_geral",   // <-- adicionar
  "pagamentos_realizados",
  "recebimentos_omie",
];
```

Filtre só os que vierem em `api_tipos` e estiverem em `TIPOS_ACEITOS`:

```ts
const tiposParaRodar = api_tipos.filter((t) => TIPOS_ACEITOS.includes(t));
```

### 2.3) Ordem de execução (mesma dos outros)

Na ordem em que a Edge já chama as APIs (ex.: categorias → clientes → movimento_financeiro → …), inclua **movimentos_geral** na **mesma estrutura** (por exemplo, depois de `movimento_financeiro`):

```ts
// Exemplo de estrutura (adaptar aos nomes exatos do seu código)
if (tiposParaRodar.includes("categorias")) { ... }
if (tiposParaRodar.includes("clientes")) { ... }
if (tiposParaRodar.includes("movimento_financeiro")) { ... }
if (tiposParaRodar.includes("movimentos_geral")) {
  // Executar sync Movimentos Geral → titulos_pagos + titulos_a_vencer (ver seção 3)
}
if (tiposParaRodar.includes("pagamentos_realizados")) { ... }
if (tiposParaRodar.includes("recebimentos_omie")) { ... }
```

---

## 3. O que executar para `movimentos_geral`

A lógica é a mesma do backend Python:

1. **Chamar a API Omie**  
   - Endpoint: `POST https://app.omie.com.br/api/v1/financas/mf/`  
   - Call: `ListarMovimentos`  
   - Param: `nPagina`, `nRegPorPagina` (ex.: 500), `lDadosCad: true`, `cExibirDepartamentos: "S"`, `dDtAltDe: "01/01/2000"`, `dDtAltAte: "<hoje DD/MM/AAAA>"`  
   - Credenciais: `app_key` e `app_secret` da empresa (já usados na Edge para outras APIs).

2. **Paginação**  
   - Enquanto `nPagina <= nTotPaginas`, buscar todas as páginas.

3. **Transformar cada movimento**  
   - Usar detalhes (prefixo `det_`) e resumo (prefixo `res_`).  
   - Ignorar registros com `cStatus === "CANCELADO"`.

4. **Filtros antes de inserir**  
   - **titulos_pagos:** `res_cLiquidado === "S"` e `det_cGrupo === "CONTA_A_RECEBER"`.  
   - **titulos_a_vencer:** `res_cLiquidado === "N"`, `det_cGrupo === "CONTA_A_RECEBER"` e `det_dDtPrevisao > hoje` (data do dia, variável).

5. **Inserir no Supabase**  
   - Por empresa: apagar registros atuais da empresa em `titulos_pagos` e `titulos_a_vencer`, depois inserir os novos.  
   - Campos: `empresa`, `ValAberto_validado`, `det_cCPFCNPJCliente`, `categ_validada`, `det_cNumDocFiscal`, `det_dDtAlt`, `det_dDtPrevisao`, `det_dDtPagamento`, `det_nCodTitulo`, `chave_empresa_cod_cliente` (empresa + '_' + det_nCodCliente).  
   - Coluna `Qtde_dias_recebimento` é gerada no banco (não enviar no insert).

6. **Log**  
   - Registrar em `api_sync_log` com `api_tipo = "movimentos_geral"` (e empresa, status, registros processados), na mesma forma que as outras APIs.

Referência no repositório:

- **API / transformação:** `api_omie_movimentos_geral.py`  
- **Sync / filtros / insert:** `sync_titulos_pagos_a_vencer_supabase.py`

---

## 4. Vercel

No Vercel **não** é preciso alterar o cron em si. O `vercel.json` já aponta para `/api/scheduler/run`.  
A rota foi ajustada para enviar `api_tipos` na URL da Edge; basta a Edge ler e incluir `movimentos_geral` como acima.

---

## 5. Checklist

- [ ] Edge **receba-sync-empresa** no Supabase: ler `empresa_id` e `api_tipos` da query string.
- [ ] Incluir `movimentos_geral` na lista de tipos aceitos e na ordem de execução (mesma estrutura dos demais).
- [ ] Implementar o bloco de execução de `movimentos_geral` (Omie ListarMovimentos Geral → filtros → insert em `titulos_pagos` e `titulos_a_vencer` + log em `api_sync_log`).
- [ ] Fazer deploy da Edge no Supabase.
- [ ] Testar: agendamento com "Movimentos Geral" marcado no horário configurado; conferir logs e tabelas no Supabase.

Depois disso, o agendamento passará a disparar a API Movimentos Geral quando o tipo estiver marcado e o cron do Vercel rodar.
