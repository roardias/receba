/**
 * Edge Function: receba-sync-empresa
 *
 * Exclusiva para: movimento_financeiro (tabela movimentos) e movimentos_geral (titulos_pagos + titulos_a_vencer).
 * Não executa clientes, categorias, pagamentos_realizados, recebimentos_omie (esses rodam em outro fluxo).
 *
 * Query params: empresa_id (obrigatório), api_tipos (opcional, ex: "movimento_financeiro,movimentos_geral")
 * Se api_tipos não for passado, roda só movimento_financeiro (comportamento original).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OMIE_ENDPOINT = "https://app.omie.com.br/api/v1/financas/mf/";
const REGISTROS_POR_PAGINA = 500;
const MAX_TENTATIVAS = 5;
const ESPERA_ENTRE_TENTATIVAS = 30_000; // ms
const BATCH_SIZE = 100;
const API_TIPO_MOVIMENTO = "movimento_financeiro";
const API_TIPO_MOVIMENTOS_GERAL = "movimentos_geral";

function apenasNumeros(val: unknown): string {
  if (typeof val !== "string") return "";
  return val.replace(/[^0-9]/g, "");
}

function parseDate(val: unknown): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, d, mon, y] = m;
    return `${y}-${mon.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function floatOr(val: unknown, def = 0): number {
  if (val == null) return def;
  const s = String(val).replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}

// ---------- Movimento Financeiro (tabela movimentos) — igual ao original ----------
function transformarMovimento(mov: any, empresaNome: string): any[] {
  let detalhes = mov?.detalhes ?? mov?.Detalhes ?? {};
  let resumo = mov?.resumo ?? mov?.Resumo ?? {};
  let departamentos = mov?.departamentos ?? mov?.Departamentos ?? [];
  let categorias = mov?.categorias ?? mov?.Categorias ?? [];

  if (Array.isArray(detalhes)) detalhes = detalhes[0] ?? {};
  if (Array.isArray(resumo)) resumo = resumo[0] ?? {};
  if (!Array.isArray(departamentos)) departamentos = departamentos ? [departamentos] : [];
  if (!Array.isArray(categorias)) categorias = categorias ? [categorias] : [];

  departamentos = departamentos.filter((d: any) => d && typeof d === "object");
  categorias = categorias.filter((c: any) => c && typeof c === "object");

  const nCodTitulo = detalhes?.nCodTitulo;
  if (nCodTitulo == null) return [];

  const cStatus = String(detalhes?.cStatus ?? "").trim().toUpperCase();
  if (cStatus === "CANCELADO") return [];

  const cLiquidado = String(resumo?.cLiquidado ?? "").trim().toUpperCase();
  if (cLiquidado === "S") return []; // só em aberto

  const safe = (v: unknown) => (v == null ? "" : String(v));

  const base: any = { empresa: empresaNome };
  if (detalhes && typeof detalhes === "object") {
    for (const [k, v] of Object.entries(detalhes)) {
      if (k) base[`det_${k}`] = safe(v);
    }
  }
  if (resumo && typeof resumo === "object") {
    for (const [k, v] of Object.entries(resumo)) {
      if (k) base[`res_${k}`] = safe(v);
    }
  }

  const listaCateg = categorias.length ? categorias : [null];
  const listaDept = departamentos.length ? departamentos : [null];

  const rows: any[] = [];

  for (const c of listaCateg) {
    for (const d of listaDept) {
      const row: any = { ...base };

      if (c) {
        row.categ_cod = safe((c as any).cCodCateg);
        const rawCateg = (c as any).nDistrPercentual;
        if (rawCateg != null && String(rawCateg).trim()) {
          try {
            row.categ_pct = String(
              Math.round((floatOr(rawCateg) / 100) * 1e6) / 1e6,
            );
          } catch {
            row.categ_pct = "1";
          }
        } else row.categ_pct = "1";
        row.categ_valor = safe((c as any).nDistrValor);
        row.categ_fixo = safe((c as any).nValorFixo);
      } else {
        row.categ_cod = "";
        row.categ_valor = "";
        row.categ_fixo = "";
        row.categ_pct = "1";
      }

      if (d) {
        row.dept_cod = safe((d as any).cCodDepartamento);
        const rawDept = (d as any).nDistrPercentual;
        if (rawDept != null && String(rawDept).trim()) {
          try {
            row.dept_pct = String(
              Math.round((floatOr(rawDept) / 100) * 1e6) / 1e6,
            );
          } catch {
            row.dept_pct = "1";
          }
        } else row.dept_pct = "1";
        row.dept_valor = safe((d as any).nDistrValor);
        row.dept_fixo = safe((d as any).nValorFixo);
      } else {
        row.dept_cod = "";
        row.dept_valor = "";
        row.dept_fixo = "";
        row.dept_pct = "1";
      }

      const categCodVal = String(row.categ_cod ?? "").trim();
      const detCod = String(row.det_cCodCateg ?? "").trim();
      row.categ_validada = categCodVal || detCod;

      const categPctDec = floatOr(row.categ_pct, 1.0);
      const deptPctDec = floatOr(row.dept_pct, 1.0);

      const detValor = floatOr(row.det_nValorTitulo, 0);
      const resValPago = floatOr(row.res_nValPago, 0);
      const resValAberto = floatOr(row.res_nValAberto, 0);

      row.valor_validado = Math.round(detValor * categPctDec * deptPctDec * 1e5) / 1e5;
      row.ValPago_validado = Math.round(resValPago * categPctDec * deptPctDec * 1e5) / 1e5;
      row.ValAberto_validado =
        resValAberto !== 0
          ? Math.round(resValAberto * categPctDec * deptPctDec * 1e5) / 1e5
          : "";

      rows.push(row);
    }
  }

  return rows;
}

const COLUNAS_TABELA = [
  "empresa",
  "categ_validada",
  "dept_cod",
  "det_cnpj_cpf_apenas_numeros",
  "det_cnumdocfiscal",
  "det_ddtemissao",
  "det_ddtpagamento",
  "det_ddtprevisao",
  "det_ncodcliente",
  "det_ncodtitulo",
  "ValPago_validado",
  "ValAberto_validado",
];

// Chamada Omie: movimento_financeiro (Contas a Receber, em aberto)
async function chamarOmieComRetry(
  appKey: string,
  appSecret: string,
  pagina: number,
  payload: any,
): Promise<any> {
  let ultimoErro: unknown = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    try {
      const body = { ...payload, param: [{ ...payload.param[0], nPagina: pagina }] };
      const resp = await fetch(OMIE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const text = await resp.text();
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} - ${text}`);
      }
      const data = text ? JSON.parse(text) : {};
      if (data.faultstring) {
        throw new Error(`Omie API: ${data.faultstring}`);
      }
      return data;
    } catch (e) {
      ultimoErro = e;
      console.log(
        `Tentativa ${tentativa}/${MAX_TENTATIVAS} falhou:`,
        e instanceof Error ? e.message : String(e),
      );
      if (tentativa < MAX_TENTATIVAS) {
        await new Promise((r) => setTimeout(r, ESPERA_ENTRE_TENTATIVAS));
      }
    }
  }

  throw ultimoErro ?? new Error("Falha ao chamar Omie");
}

async function listarMovimentosPaginado(
  appKey: string,
  appSecret: string,
  empresaNome: string,
  payload: any,
): Promise<any[]> {
  const todos: any[] = [];
  let pagina = 1;
  let nTotPaginas = 1;

  while (true) {
    console.log(`[${empresaNome}] Página ${pagina}...`);
    const data = await chamarOmieComRetry(appKey, appSecret, pagina, payload);

    nTotPaginas = data?.nTotPaginas ?? 1;
    const movimentosRaw = data?.movimentos ?? [];
    const movimentos = Array.isArray(movimentosRaw)
      ? movimentosRaw
      : movimentosRaw
      ? [movimentosRaw]
      : [];

    for (const mov of movimentos) {
      const rows = transformarMovimento(mov, empresaNome);
      todos.push(...rows);
    }

    console.log(
      `[${empresaNome}] Página ${pagina}: ${movimentos.length} movimentos (total linhas=${todos.length})`,
    );

    if (pagina >= nTotPaginas) break;
    pagina += 1;
    await new Promise((r) => setTimeout(r, 1000));
  }

  return todos;
}

async function limparMovimentosEmpresa(
  supabase: ReturnType<typeof createClient>,
  empresaNome: string,
): Promise<void> {
  console.log(`[sync_movimentos] DELETE movimentos empresa='${empresaNome}'`);
  const { error } = await supabase
    .from("movimentos")
    .delete()
    .eq("empresa", empresaNome);
  if (error) {
    console.error(
      `[sync_movimentos] ERRO no DELETE para empresa='${empresaNome}':`,
      error.message,
    );
  }
}

async function inserirBatchMovimentos(
  supabase: ReturnType<typeof createClient>,
  registros: any[],
): Promise<number> {
  let total = 0;
  for (let i = 0; i < registros.length; i += BATCH_SIZE) {
    const batchSrc = registros.slice(i, i + BATCH_SIZE);
    const batch = batchSrc.map((m) => {
      const out: any = {};
      for (const k of COLUNAS_TABELA) {
        if (k === "det_cnpj_cpf_apenas_numeros") {
          out[k] = apenasNumeros(m.det_cCPFCNPJCliente ?? m.det_cCPFCNPJ ?? "");
        } else if (k === "det_ddtemissao") {
          out[k] = parseDate(m.det_dDtEmissao);
        } else if (k === "det_ddtpagamento") {
          out[k] = parseDate(m.det_dDtPagamento);
        } else if (k === "det_ddtprevisao") {
          out[k] = parseDate(m.det_dDtPrevisao);
        } else if (k === "det_cnumdocfiscal") {
          out[k] = m.det_cNumDocFiscal ?? "";
        } else if (k === "det_ncodcliente") {
          out[k] = m.det_nCodCliente ?? "";
        } else if (k === "det_ncodtitulo") {
          out[k] = m.det_nCodTitulo ?? "";
        } else {
          out[k] = m[k] ?? null;
        }
      }
      return out;
    });

    if (!batch.length) continue;

    const { error } = await supabase.from("movimentos").insert(batch);
    if (error) {
      console.error(
        "[sync_movimentos] ERRO ao inserir batch:",
        error.message,
      );
      throw new Error(error.message);
    }
    total += batch.length;
  }
  return total;
}

async function registrarLog(
  supabase: ReturnType<typeof createClient>,
  empresaNome: string,
  apiTipo: string,
  status: "sucesso" | "erro",
  registros: number,
  mensagemErro?: string,
) {
  const agora = new Date().toISOString();
  const { error } = await supabase.from("api_sync_log").insert({
    empresa_nome: empresaNome,
    api_tipo: apiTipo,
    iniciado_em: agora,
    finalizado_em: agora,
    status,
    registros_processados: registros,
    mensagem_erro: mensagemErro ?? null,
  });
  if (error) {
    console.error("[sync] ERRO ao registrar log:", error.message);
  }
}

// ---------- Movimentos Geral (titulos_pagos + titulos_a_vencer) ----------
const COLUNAS_TITULOS = [
  "empresa",
  "ValAberto_validado",
  "det_ccpfcnpjcliente",
  "categ_validada",
  "det_cnumdocfiscal",
  "det_ddtalt",
  "det_ddtprevisao",
  "det_ddtpagamento",
  "det_ncodtitulo",
  "chave_empresa_cod_cliente",
];

function parseDateToDate(val: unknown): Date | null {
  const iso = parseDate(val);
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function hojeOmie(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Transformar movimento para Geral (sem filtrar cLiquidado; CANCELADO continua fora)
function transformarMovimentoGeral(mov: any, empresaNome: string): any[] {
  let detalhes = mov?.detalhes ?? mov?.Detalhes ?? {};
  let resumo = mov?.resumo ?? mov?.Resumo ?? {};
  let departamentos = mov?.departamentos ?? mov?.Departamentos ?? [];
  let categorias = mov?.categorias ?? mov?.Categorias ?? [];

  if (Array.isArray(detalhes)) detalhes = detalhes[0] ?? {};
  if (Array.isArray(resumo)) resumo = resumo[0] ?? {};
  if (!Array.isArray(departamentos)) departamentos = departamentos ? [departamentos] : [];
  if (!Array.isArray(categorias)) categorias = categorias ? [categorias] : [];

  departamentos = departamentos.filter((d: any) => d && typeof d === "object");
  categorias = categorias.filter((c: any) => c && typeof c === "object");

  const cStatus = String(detalhes?.cStatus ?? "").trim().toUpperCase();
  if (cStatus === "CANCELADO") return [];

  const safe = (v: unknown) => (v == null ? "" : String(v));
  const base: any = { empresa: empresaNome };
  if (detalhes && typeof detalhes === "object") {
    for (const [k, v] of Object.entries(detalhes)) {
      if (k) base[`det_${k}`] = safe(v);
    }
  }
  if (resumo && typeof resumo === "object") {
    for (const [k, v] of Object.entries(resumo)) {
      if (k) base[`res_${k}`] = safe(v);
    }
  }

  const listaCateg = categorias.length ? categorias : [null];
  const listaDept = departamentos.length ? departamentos : [null];
  const rows: any[] = [];

  for (const c of listaCateg) {
    for (const d of listaDept) {
      const row: any = { ...base };
      if (c) {
        row.categ_cod = safe((c as any).cCodCateg);
        const rawCateg = (c as any).nDistrPercentual;
        row.categ_pct = rawCateg != null && String(rawCateg).trim()
          ? String(Math.round((floatOr(rawCateg) / 100) * 1e6) / 1e6)
          : "1";
        row.categ_valor = safe((c as any).nDistrValor);
        row.categ_fixo = safe((c as any).nValorFixo);
      } else {
        row.categ_cod = row.categ_valor = row.categ_fixo = "";
        row.categ_pct = "1";
      }
      if (d) {
        row.dept_cod = safe((d as any).cCodDepartamento);
        const rawDept = (d as any).nDistrPercentual;
        row.dept_pct = rawDept != null && String(rawDept).trim()
          ? String(Math.round((floatOr(rawDept) / 100) * 1e6) / 1e6)
          : "1";
        row.dept_valor = safe((d as any).nDistrValor);
        row.dept_fixo = safe((d as any).nValorFixo);
      } else {
        row.dept_cod = row.dept_valor = row.dept_fixo = "";
        row.dept_pct = "1";
      }
      const categCodVal = String(row.categ_cod ?? "").trim();
      const detCod = String(row.det_cCodCateg ?? "").trim();
      row.categ_validada = categCodVal || detCod;

      const cp = floatOr(row.categ_pct, 1);
      const dp = floatOr(row.dept_pct, 1);
      const resValAberto = floatOr(row.res_nValAberto, 0);
      row.ValAberto_validado = resValAberto !== 0
        ? Math.round(resValAberto * cp * dp * 1e5) / 1e5
        : null;
      rows.push(row);
    }
  }
  return rows;
}

function filtrarTitulosPagos(registros: any[]): any[] {
  return registros.filter((r) => {
    const liq = String(r.res_cLiquidado ?? "").trim().toUpperCase();
    const grupo = String(r.det_cGrupo ?? "").trim().toUpperCase();
    return liq === "S" && grupo === "CONTA_A_RECEBER";
  });
}

function filtrarTitulosAVencer(registros: any[]): any[] {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return registros.filter((r) => {
    const liq = String(r.res_cLiquidado ?? "").trim().toUpperCase();
    const grupo = String(r.det_cGrupo ?? "").trim().toUpperCase();
    if (liq !== "N" || grupo !== "CONTA_A_RECEBER") return false;
    const previsao = parseDateToDate(r.det_dDtPrevisao);
    if (!previsao) return false;
    previsao.setHours(0, 0, 0, 0);
    return previsao > hoje;
  });
}

function dedupePorTitulo(registros: any[]): any[] {
  const seen = new Set<string>();
  return registros.filter((r) => {
    const key = `${String(r.empresa ?? "").trim()}|${String(r.det_nCodTitulo ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rowParaTabelaTitulos(row: any): any {
  const empresa = String(row.empresa ?? "").trim();
  const codCliente = String(row.det_nCodCliente ?? "").trim();
  const chave = empresa || codCliente ? `${empresa}_${codCliente}` : empresa || codCliente;

  let detNcodtitulo: number | null = null;
  const nc = row.det_nCodTitulo;
  if (nc != null && nc !== "") {
    const n = parseFloat(String(nc).replace(",", "."));
    if (!Number.isNaN(n)) detNcodtitulo = Math.floor(n);
  }

  let ValAberto: number | null = null;
  const va = row.ValAberto_validado;
  if (va != null && va !== "") {
    const n = parseFloat(String(va).replace(",", "."));
    if (!Number.isNaN(n)) ValAberto = n;
  }

  return {
    empresa,
    ValAberto_validado: ValAberto,
    det_ccpfcnpjcliente: String(row.det_cCPFCNPJCliente ?? "").trim(),
    categ_validada: String(row.categ_validada ?? "").trim(),
    det_cnumdocfiscal: String(row.det_cNumDocFiscal ?? "").trim(),
    det_ddtalt: parseDate(row.det_dDtAlt),
    det_ddtprevisao: parseDate(row.det_dDtPrevisao),
    det_ddtpagamento: parseDate(row.det_dDtPagamento),
    det_ncodtitulo: detNcodtitulo,
    chave_empresa_cod_cliente: chave,
  };
}

async function runMovimentosGeral(
  supabase: ReturnType<typeof createClient>,
  empresaNome: string,
  appKey: string,
  appSecret: string,
): Promise<number> {
  const payloadGeral = {
    call: "ListarMovimentos",
    param: [
      {
        nPagina: 1,
        nRegPorPagina: REGISTROS_POR_PAGINA,
        lDadosCad: true,
        cExibirDepartamentos: "S",
        dDtAltDe: "01/01/2000",
        dDtAltAte: hojeOmie(),
      },
    ],
    app_key: appKey,
    app_secret: appSecret,
  };

  const todosGeral: any[] = [];
  let pagina = 1;
  let nTotPaginas = 1;
  while (true) {
    const data = await chamarOmieComRetry(appKey, appSecret, pagina, payloadGeral);
    nTotPaginas = data?.nTotPaginas ?? 1;
    const movimentosRaw = data?.movimentos ?? [];
    const movimentos = Array.isArray(movimentosRaw) ? movimentosRaw : movimentosRaw ? [movimentosRaw] : [];
    for (const mov of movimentos) {
      const rows = transformarMovimentoGeral(mov, empresaNome);
      todosGeral.push(...rows);
    }
    if (pagina >= nTotPaginas) break;
    pagina++;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const pagosRaw = filtrarTitulosPagos(todosGeral);
  const aVencerRaw = filtrarTitulosAVencer(todosGeral);
  const pagosDedup = dedupePorTitulo(pagosRaw);
  const aVencerDedup = dedupePorTitulo(aVencerRaw);
  const pagos = pagosDedup.map(rowParaTabelaTitulos);
  const aVencer = aVencerDedup.map(rowParaTabelaTitulos);

  await supabase.from("titulos_pagos").delete().eq("empresa", empresaNome);
  await supabase.from("titulos_a_vencer").delete().eq("empresa", empresaNome);

  let total = 0;
  const toRow = (o: any) => {
    const r: any = {};
    for (const k of COLUNAS_TITULOS) if (o[k] !== undefined) r[k] = o[k];
    return r;
  };
  for (let i = 0; i < pagos.length; i += BATCH_SIZE) {
    const batch = pagos.slice(i, i + BATCH_SIZE).map(toRow);
    if (batch.length) {
      await supabase.from("titulos_pagos").insert(batch);
      total += batch.length;
    }
  }
  for (let i = 0; i < aVencer.length; i += BATCH_SIZE) {
    const batch = aVencer.slice(i, i + BATCH_SIZE).map(toRow);
    if (batch.length) {
      await supabase.from("titulos_a_vencer").insert(batch);
      total += batch.length;
    }
  }

  await registrarLog(supabase, empresaNome, API_TIPO_MOVIMENTOS_GERAL, "sucesso", total);
  return total;
}

// ---------- Handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const empresaId = url.searchParams.get("empresa_id");
  const apiTiposParam = url.searchParams.get("api_tipos");
  const api_tipos: string[] = apiTiposParam
    ? apiTiposParam.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar definidos.",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!empresaId) {
    return new Response(
      JSON.stringify({ ok: false, error: "Parâmetro empresa_id é obrigatório." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Só executamos o que esta Edge trata; ignoramos clientes, categorias, etc.
  const runMovimentoFinanceiro = api_tipos.length === 0 || api_tipos.includes("movimento_financeiro");
  const runMovimentosGeralFlag = api_tipos.includes("movimentos_geral");

  try {
    const { data: empresa, error: errEmp } = await supabase
      .from("empresas")
      .select("id, nome_curto, app_key, app_secret")
      .eq("id", empresaId)
      .single();

    if (errEmp || !empresa) {
      throw new Error(
        `Empresa não encontrada ou erro ao buscar: ${errEmp?.message ?? "sem detalhes"}`,
      );
    }

    const empresaNome: string = empresa.nome_curto;
    const appKey: string = empresa.app_key;
    const appSecret: string = empresa.app_secret ?? "";

    if (!appKey || !appSecret) {
      throw new Error("app_key ou app_secret ausentes para esta empresa.");
    }

    const resultado: any = { ok: true, empresa_id: empresaId, empresa_nome: empresaNome };

    if (runMovimentoFinanceiro) {
      console.log(
        `[receba-sync-empresa] Iniciando sync movimento_financeiro para empresa_id=${empresaId}, nome=${empresaNome}`,
      );
      const payloadMovimento = {
        call: "ListarMovimentos",
        param: [
          {
            nPagina: 1,
            nRegPorPagina: REGISTROS_POR_PAGINA,
            cNatureza: "R",
            cTpLancamento: "CR",
            lDadosCad: true,
            cExibirDepartamentos: "S",
          },
        ],
        app_key: appKey,
        app_secret: appSecret,
      };

      const registrosRaw = await listarMovimentosPaginado(appKey, appSecret, empresaNome, payloadMovimento);
      console.log(
        `[receba-sync-empresa] Total linhas (movimento_financeiro) para '${empresaNome}':`,
        registrosRaw.length,
      );

      await limparMovimentosEmpresa(supabase, empresaNome);

      if (registrosRaw.length === 0) {
        await registrarLog(supabase, empresaNome, API_TIPO_MOVIMENTO, "sucesso", 0);
        resultado.movimento_financeiro = { inseridos: 0 };
      } else {
        const inseridos = await inserirBatchMovimentos(supabase, registrosRaw);
        await registrarLog(supabase, empresaNome, API_TIPO_MOVIMENTO, "sucesso", inseridos);
        resultado.movimento_financeiro = { inseridos };
        console.log(
          `[receba-sync-empresa] movimento_financeiro concluído para '${empresaNome}': ${inseridos} registros.`,
        );
      }
    }

    if (runMovimentosGeralFlag) {
      console.log(
        `[receba-sync-empresa] Iniciando sync movimentos_geral para empresa_id=${empresaId}, nome=${empresaNome}`,
      );
      try {
        const totalGeral = await runMovimentosGeral(supabase, empresaNome, appKey, appSecret);
        resultado.movimentos_geral = { registros: totalGeral };
        console.log(
          `[receba-sync-empresa] movimentos_geral concluído para '${empresaNome}': ${totalGeral} registros.`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await registrarLog(supabase, empresaNome, API_TIPO_MOVIMENTOS_GERAL, "erro", 0, msg);
        throw e;
      }
    }

    return new Response(
      JSON.stringify(resultado),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[receba-sync-empresa] ERRO geral:", msg);
    try {
      const { data: empresa } = await supabase
        .from("empresas")
        .select("nome_curto")
        .eq("id", empresaId)
        .single();
      if (empresa?.nome_curto) {
        await registrarLog(supabase, empresa.nome_curto, API_TIPO_MOVIMENTO, "erro", 0, msg);
      }
    } catch {}
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
