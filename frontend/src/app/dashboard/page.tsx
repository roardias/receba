"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { normalizarClienteNome } from "@/lib/clienteNome";
import { useAuth } from "@/contexts/AuthContext";

type Grupo = { id: string; nome: string };
type Empresa = { id: string; nome_curto: string; grupo_id: string | null };
type DashboardRow = {
  movimento_id: string;
  chave_cliente: string | null;
  empresa: string;
  det_cnumdocfiscal: string | null;
  det_ddtemissao: string | null;
  det_ddtprevisao: string | null;
  ValPago_validado: number | null;
  ValAberto_validado: number | null;
  qtde_dias: number | null;
  nome_fantasia: string | null;
  codigo_nome_fantasia: string | null;
  razao_social: string | null;
  cnpj_cpf: string | null;
  categoria_descricao: string | null;
  tag_top_40: string | null;
  grupo_empresas: string | null;
};

const STATUS_OPCOES = [
  { value: "em_cobranca", label: "Em cobrança" },
  { value: "negociado_pagamento", label: "Negociado pagamento" },
  { value: "nao_cumpriu_promessa_pagamento", label: "Não cumpriu promessa de pagamento" },
  { value: "bloqueado", label: "Bloqueado" },
  { value: "protestado", label: "Protestado" },
  { value: "em_acao_judicial", label: "Em ação judicial" },
] as const;

function formatarMoeda(val: number | null) {
  if (val == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(val);
}

/** Valor numérico para exportação Excel/CSV (sem R$). */
function valorParaExcel(val: number | null): string {
  if (val == null) return "";
  return Number(val).toFixed(2);
}

function valorAtualizado(valAberto: number | null, qtdeDias: number | null): number | null {
  if (valAberto == null) return null;
  const dias = qtdeDias ?? 0;
  if (dias <= 0) return valAberto;
  const multa = 0.02;
  const jurosMensal = 0.01;
  const jurosDiario = Math.pow(1 + jurosMensal, 1 / 30) - 1;
  const comMulta = valAberto * (1 + multa);
  const valor = comMulta * Math.pow(1 + jurosDiario, dias);
  return Math.round(valor * 100) / 100;
}

function formatarData(val: string | null) {
  if (!val) return "—";
  const s = val.trim();
  // Quando vem do Postgres como DATE, o formato é "YYYY-MM-DD" (sem timezone).
  // Para evitar o shift de fuso horário do new Date(), formatamos manualmente.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [, y, mo, d] = m;
    return `${d}/${mo}/${y}`;
  }
  // Fallback para valores com horário (ISO completo), se aparecerem.
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) {
    return dt.toLocaleDateString("pt-BR");
  }
  return s;
}

const ASSUNTO_PADRAO = "Informações importantes sobre seus serviços na Alldax • Grupo 3SA";
const MENSAGEM_PADRAO = `Olá, tudo bem?

Esperamos que sua semana esteja sendo excelente.
Estamos entrando em contato para compartilhar uma atualização importante sobre o seu cadastro conosco na Alldax • Grupo 3SA.

Nosso sistema identificou a existência de um ou mais pagamentos pendentes relacionados aos serviços prestados. Sabemos que imprevistos acontecem e que, na correria diária, algo pode passar despercebido. Por isso, queremos facilitar a regularização e garantir que tudo continue funcionando da melhor forma possível.

Se precisar da segunda via dos boletos ou tiver qualquer dúvida, basta responder a este e-mail e nossa equipe retornará rapidamente para ajudar.
Caso o pagamento já tenha sido realizado, por favor, desconsidere esta mensagem.

Importante:
Todos os nossos boletos são descontados antecipadamente pelo banco. O não pagamento pode gerar protesto automático e bloqueio no sistema de contabilidade, pois todo o processo é integrado. Por esse motivo, recomendamos a regularização o quanto antes para evitar qualquer inconveniente.

Estamos à disposição para ajudar.
Atenciosamente,
Depto Financeiro
WhatsApp: 61 3031-3100
Alldax • Grupo 3SA`;

function formatarDadosComoTexto(rows: DashboardRow[], tipo: "cliente" | "grupo"): string {
  if (tipo === "cliente") {
    const linhas = ["Emissão\tVencimento\tDias\tNF\tCategoria\tVal. Pago\tVal. Aberto\tVal. Atualizado"];
    for (const r of rows) {
      linhas.push(
        [formatarData(r.det_ddtemissao), formatarData(r.det_ddtprevisao), r.qtde_dias ?? "—", r.det_cnumdocfiscal ?? "—", r.categoria_descricao ?? "—", formatarMoeda(r.ValPago_validado), formatarMoeda(r.ValAberto_validado), formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias))].join("\t")
      );
    }
    return linhas.join("\n");
  }
  const linhas = ["Cód.\tCliente\tEmissão\tVencimento\tDias\tNF\tCategoria\tVal. Pago\tVal. Aberto\tVal. Atualizado"];
  for (const r of rows) {
    linhas.push(
      [r.codigo_nome_fantasia ?? "—", r.nome_fantasia ?? "—", formatarData(r.det_ddtemissao), formatarData(r.det_ddtprevisao), r.qtde_dias ?? "—", r.det_cnumdocfiscal ?? "—", r.categoria_descricao ?? "—", formatarMoeda(r.ValPago_validado), formatarMoeda(r.ValAberto_validado), formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias))].join("\t")
    );
  }
  return linhas.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatarCnpjCpf(val: string | null): string {
  if (!val) return "—";
  const nums = val.replace(/\D/g, "");
  if (nums.length === 14) {
    return nums.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (nums.length === 11) {
    return nums.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return val;
}

function clientesUnicos(rows: DashboardRow[]): DashboardRow[] {
  const seen = new Set<string>();
  const out: DashboardRow[] = [];
  for (const r of rows) {
    const key = r.codigo_nome_fantasia ?? r.cnpj_cpf ?? "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

function blocosDadosClienteHtml(rows: DashboardRow[]): string {
  const clientes = clientesUnicos(rows);
  const blocos = clientes.map(
    (r) =>
      `<div style="margin-bottom:16px;padding:12px;background:#f1f5f9;border-radius:6px;font-size:14px;page-break-inside:avoid;break-inside:avoid"><p style="margin:0 0 4px 0"><strong>Nome fantasia:</strong> ${escapeHtml(
        r.nome_fantasia ?? "—"
      )}</p><p style="margin:0 0 4px 0"><strong>Razão social:</strong> ${escapeHtml(
        r.razao_social ?? "—"
      )}</p><p style="margin:0"><strong>CNPJ/CPF:</strong> ${escapeHtml(formatarCnpjCpf(r.cnpj_cpf))}</p></div>`
  );
  return blocos.join("");
}

function formatarDadosComoHtml(rows: DashboardRow[], tipo: "cliente" | "grupo"): string {
  if (tipo === "cliente") {
    let trs = rows
      .map(
        (r) =>
          `<tr style="page-break-inside:avoid;break-inside:avoid"><td>${escapeHtml(
            formatarData(r.det_ddtemissao)
          )}</td><td>${escapeHtml(formatarData(r.det_ddtprevisao))}</td><td>${r.qtde_dias ?? "—"}</td><td>${escapeHtml(
            r.det_cnumdocfiscal ?? "—"
          )}</td><td>${escapeHtml(r.categoria_descricao ?? "—")}</td><td style="text-align:right">${escapeHtml(
            formatarMoeda(r.ValPago_validado)
          )}</td><td style="text-align:right">${escapeHtml(formatarMoeda(r.ValAberto_validado))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias)))}</td></tr>`
      )
      .join("");
    return `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#e2e8f0"><th>Emissão</th><th>Vencimento</th><th>Dias</th><th>NF</th><th>Categoria</th><th style="text-align:right">Val. Pago</th><th style="text-align:right">Val. Aberto</th><th style="text-align:right">Val. Atualizado</th></tr></thead><tbody>${trs}</tbody></table>`;
  }
  let trs = rows
    .map(
      (r) =>
        `<tr style="page-break-inside:avoid;break-inside:avoid"><td>${escapeHtml(
          r.codigo_nome_fantasia ?? "—"
        )}</td><td>${escapeHtml(r.nome_fantasia ?? "—")}</td><td>${escapeHtml(
          formatarData(r.det_ddtemissao)
        )}</td><td>${escapeHtml(formatarData(r.det_ddtprevisao))}</td><td>${r.qtde_dias ?? "—"}</td><td>${escapeHtml(
          r.det_cnumdocfiscal ?? "—"
        )}</td><td>${escapeHtml(r.categoria_descricao ?? "—")}</td><td style="text-align:right">${escapeHtml(
          formatarMoeda(r.ValPago_validado)
        )}</td><td style="text-align:right">${escapeHtml(formatarMoeda(r.ValAberto_validado))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias)))}</td></tr>`
    )
    .join("");
  return `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#e2e8f0"><th>Cód.</th><th>Cliente</th><th>Emissão</th><th>Vencimento</th><th>Dias</th><th>NF</th><th>Categoria</th><th style="text-align:right">Val. Pago</th><th style="text-align:right">Val. Aberto</th><th style="text-align:right">Val. Atualizado</th></tr></thead><tbody>${trs}</tbody></table>`;
}

function calcularTotaisPorCliente(rows: DashboardRow[]) {
  const map = new Map<string, { cliente: string; valPago: number; valAberto: number; valAtualizado: number }>();
  for (const r of rows) {
    const codigo = r.codigo_nome_fantasia ?? "";
    const nome = r.nome_fantasia ?? "";
    const key = codigo || nome || r.cnpj_cpf || "—";
    const label = codigo ? `${codigo}${nome ? " - " + nome : ""}` : nome || "—";
    const vp = r.ValPago_validado ?? 0;
    const va = r.ValAberto_validado ?? 0;
    const vAtual = valorAtualizado(r.ValAberto_validado, r.qtde_dias) ?? 0;
    const atual = map.get(key) || { cliente: label, valPago: 0, valAberto: 0, valAtualizado: 0 };
    atual.valPago += vp;
    atual.valAberto += va;
    atual.valAtualizado += vAtual;
    map.set(key, atual);
  }
  return Array.from(map.values());
}

function agruparPorEmpresa(rows: DashboardRow[]): Map<string, DashboardRow[]> {
  const map = new Map<string, DashboardRow[]>();
  for (const r of rows) {
    const emp = r.empresa ?? "Sem empresa";
    const lista = map.get(emp) || [];
    lista.push(r);
    map.set(emp, lista);
  }
  return map;
}

function buildRelatorioHtml(
  titulo: string,
  rows: DashboardRow[],
  tipo: "cliente" | "grupo",
  backgroundColor: string,
  logoUrl: string | null,
  empresasInternasNomes: string
): string {
  const bg = backgroundColor || "#FFFFFF";
  const agora = new Date().toLocaleString("pt-BR");

  const logoBlock = logoUrl
    ? `<div style="padding:16px;background:${escapeHtml(bg)};text-align:center;margin-bottom:20px"><img src="${logoUrl}" alt="Logo" style="max-height:80px;max-width:280px;height:auto;display:block;margin:0 auto" /></div>`
    : `<div style="padding:12px;background:${escapeHtml(bg)};margin-bottom:20px"></div>`;

  const cabecalho = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a;margin-bottom:16px"><h1 style="margin:0 0 8px 0;font-size:20px">${escapeHtml(
    titulo
  )}</h1><p style="margin:0 0 4px 0"><strong>Empresas internas:</strong> ${escapeHtml(
    empresasInternasNomes || "—"
  )}</p><p style="margin:0 0 4px 0"><strong>Data/hora:</strong> ${escapeHtml(agora)}</p></div>`;

  if (tipo === "grupo") {
    const porCliente = new Map<string, { label: string; rows: DashboardRow[] }>();
    for (const r of rows) {
      const codigo = r.codigo_nome_fantasia ?? "";
      const nome = r.nome_fantasia ?? "";
      const key = codigo || nome || r.cnpj_cpf || "—";
      const label = codigo ? `${codigo} - ${nome || "Sem nome"}` : nome || "—";
      const entry = porCliente.get(key) || { label, rows: [] };
      entry.rows.push(r);
      porCliente.set(key, entry);
    }

    const clientes = Array.from(porCliente.keys()).sort();
    const totaisCliente: { label: string; valPago: number; valAberto: number; valAtualizado: number }[] = [];
    let totalGeralPago = 0;
    let totalGeralAberto = 0;
    let totalGeralAtualizado = 0;

    const blocosClientes = clientes.map((key) => {
      const { label, rows: clienteRows } = porCliente.get(key)!;
      let valPago = 0;
      let valAberto = 0;
      let valAtualizado = 0;
      for (const r of clienteRows) {
        valPago += r.ValPago_validado ?? 0;
        valAberto += r.ValAberto_validado ?? 0;
        valAtualizado += valorAtualizado(r.ValAberto_validado, r.qtde_dias) ?? 0;
      }
      totaisCliente.push({ label, valPago, valAberto, valAtualizado });
      totalGeralPago += valPago;
      totalGeralAberto += valAberto;
      totalGeralAtualizado += valAtualizado;

      const trs = clienteRows
        .map(
          (r) =>
            `<tr style="page-break-inside:avoid;break-inside:avoid"><td>${escapeHtml(formatarData(r.det_ddtemissao))}</td><td>${escapeHtml(formatarData(r.det_ddtprevisao))}</td><td>${r.qtde_dias ?? "—"}</td><td>${escapeHtml(r.det_cnumdocfiscal ?? "—")}</td><td>${escapeHtml(r.categoria_descricao ?? "—")}</td><td style="text-align:right">${escapeHtml(formatarMoeda(r.ValPago_validado))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(r.ValAberto_validado))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias)))}</td></tr>`
        )
        .join("");

      const totalRow = `<tr style="font-weight:bold;background:#f1f5f9"><td colspan="5" style="text-align:right">Total:</td><td style="text-align:right">${escapeHtml(
        formatarMoeda(valPago)
      )}</td><td style="text-align:right">${escapeHtml(formatarMoeda(valAberto))}</td><td style="text-align:right">${escapeHtml(
        formatarMoeda(valAtualizado)
      )}</td></tr>`;

      const tabelaHtml = `<table border="1" cellpadding="8" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#e2e8f0"><th>Emissão</th><th>Vencimento</th><th>Dias</th><th>NF</th><th>Categoria</th><th style="text-align:right">Val. Pago</th><th style="text-align:right">Val. Aberto</th><th style="text-align:right">Val. Atualizado</th></tr></thead><tbody>${trs}</tbody><tfoot>${totalRow}</tfoot></table>`;

      return `<div style="margin-bottom:24px;page-break-inside:avoid;break-inside:avoid"><h3 style="margin:0 0 8px 0;font-size:15px;color:#1e293b">${escapeHtml(label)}</h3>${tabelaHtml}</div>`;
    }).join("");

    const totaisClienteHtml = totaisCliente
      .map(
        (t) =>
          `<tr><td>${escapeHtml(t.label)}</td><td style="text-align:right">${escapeHtml(formatarMoeda(t.valPago))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(t.valAberto))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(t.valAtualizado))}</td></tr>`
      )
      .join("");

    const blocoResumo = `<div style="margin-bottom:24px;font-size:14px"><p style="font-weight:bold;margin:0 0 6px 0">Resumo por cliente</p><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#e2e8f0"><th>Cliente</th><th style="text-align:right">Val. Pago</th><th style="text-align:right">Val. Aberto</th><th style="text-align:right">Val. Atualizado</th></tr></thead><tbody>${totaisClienteHtml}</tbody></table><p style="margin-top:8px"><strong>Total geral:</strong> Pago ${escapeHtml(formatarMoeda(totalGeralPago))} — Aberto ${escapeHtml(formatarMoeda(totalGeralAberto))} — Atualizado ${escapeHtml(formatarMoeda(totalGeralAtualizado))}</p></div>`;

    const detalhamentoTitulo = `<div style="margin-bottom:12px"><p style="font-weight:bold;font-size:15px;margin:0">Detalhamento por cliente</p></div>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(
      titulo
    )}</title></head><body style="margin:0;padding:20px;background:#f8fafc">${logoBlock}${cabecalho}${blocoResumo}${detalhamentoTitulo}${blocosClientes}</body></html>`;
  }

  const totaisPorCliente = calcularTotaisPorCliente(rows);
  const totalGeral = totaisPorCliente.reduce(
    (acc, t) => ({
      valPago: acc.valPago + t.valPago,
      valAberto: acc.valAberto + t.valAberto,
      valAtualizado: acc.valAtualizado + t.valAtualizado,
    }),
    { valPago: 0, valAberto: 0, valAtualizado: 0 }
  );

  const totaisClienteHtml = totaisPorCliente
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.cliente)}</td><td style="text-align:right">${escapeHtml(
          formatarMoeda(t.valPago)
        )}</td><td style="text-align:right">${escapeHtml(formatarMoeda(t.valAberto))}</td><td style="text-align:right">${escapeHtml(formatarMoeda(t.valAtualizado))}</td></tr>`
    )
    .join("");

  const blocoTotais = `<div style="margin-top:12px;margin-bottom:20px;font-size:14px"><p style="font-weight:bold;margin:0 0 4px 0">Totais por cliente</p><table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr style="background:#e2e8f0"><th>Cliente</th><th style="text-align:right">Val. Pago</th><th style="text-align:right">Val. Aberto</th><th style="text-align:right">Val. Atualizado</th></tr></thead><tbody>${totaisClienteHtml}</tbody></table><p style="margin-top:8px"><strong>Total geral:</strong> Pago ${escapeHtml(
    formatarMoeda(totalGeral.valPago)
  )} — Aberto ${escapeHtml(formatarMoeda(totalGeral.valAberto))} — Atualizado ${escapeHtml(formatarMoeda(totalGeral.valAtualizado))}</p></div>`;

  const clientesBlock = `<div style="margin-top:12px"><p style="font-weight:bold;margin-bottom:8px">Dados do(s) cliente(s):</p>${blocosDadosClienteHtml(
    rows
  )}</div>`;

  const tabelaHtml = formatarDadosComoHtml(rows, tipo);
  const dadosBlock = `<div style="margin-top:20px"><p style="font-weight:bold;margin-bottom:8px">Detalhamento:</p>${tabelaHtml}</div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(
    titulo
  )}</title></head><body style="margin:0;padding:20px;background:#f8fafc">${logoBlock}${cabecalho}${blocoTotais}${clientesBlock}${dadosBlock}</body></html>`;
}

const LOGO_PLACEHOLDER = "__LOGO_SRC__";

function buildEmailHtml(
  mensagem: string,
  rows: DashboardRow[],
  tipo: "cliente" | "grupo",
  backgroundColor: string,
  temLogo: boolean
): string {
  const bg = backgroundColor || "#FFFFFF";
  const logoBlock = temLogo
    ? `<div style="padding:16px;background:${escapeHtml(bg)};text-align:center;margin-bottom:20px"><img src="${LOGO_PLACEHOLDER}" alt="Logo" style="max-height:80px;max-width:280px;height:auto;display:block;margin:0 auto" /></div>`
    : `<div style="padding:12px;background:${escapeHtml(bg)};margin-bottom:20px"></div>`;
  const msgEscaped = escapeHtml(mensagem.trim()).replace(/\n/g, "<br/>");
  const msgBlock = `<div style="font-family:Georgia,serif;font-size:15px;line-height:1.6;color:#334155">${msgEscaped}</div>`;
  const clientesBlock = `<div style="margin-top:20px"><p style="font-weight:bold;margin-bottom:8px">Dados do(s) cliente(s):</p>${blocosDadosClienteHtml(rows)}</div>`;
  const tabelaHtml = formatarDadosComoHtml(rows, tipo);
  const dadosBlock = `<div style="margin-top:20px"><p style="font-weight:bold;margin-bottom:8px">Dados:</p>${tabelaHtml}</div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:20px;background:#f8fafc">${logoBlock}${msgBlock}${clientesBlock}${dadosBlock}</body></html>`;
}

export default function DashboardPage() {
  const { hasPermissao } = useAuth();
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [grupoId, setGrupoId] = useState<string>("");
  const [empresaId, setEmpresaId] = useState<string>("");
  const [dados, setDados] = useState<DashboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingDados, setLoadingDados] = useState(false);
  const [atualizandoView, setAtualizandoView] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [buscaCliente, setBuscaCliente] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("");
  type SortCol = "cod" | "cliente" | "valPago" | "valAberto" | "valAtualizado";
  const [sortCol, setSortCol] = useState<SortCol>("valAberto");
  const [sortAsc, setSortAsc] = useState(false);
  const [statusPorChave, setStatusPorChave] = useState<Record<string, { status: string; data_negociado: string | null }>>({});
  const [statusDashboard, setStatusDashboard] = useState<Record<string, { status: string; data_negociado: string | null }>>({});
  /** Data do último contato (cobranças realizadas) por chave "cod|cnpj" (apenas dígitos no cnpj). */
  const [ultimoContatoPorChave, setUltimoContatoPorChave] = useState<Record<string, string>>({});

  function handleSort(col: SortCol) {
    setSortCol(col);
    setSortAsc((prev) =>
      col === sortCol ? !prev : col === "cliente" || col === "cod"
    );
  }

  const [allowedGrupoIds, setAllowedGrupoIds] = useState<Set<string>>(new Set());
  const [allowedEmpresaIds, setAllowedEmpresaIds] = useState<Set<string>>(new Set());
  const [allowedCategorias, setAllowedCategorias] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      const [resGrupos, resEmpresas, resPG, resPE, resPC] = await Promise.all([
        supabase.from("grupos").select("id, nome").order("nome"),
        supabase.from("empresas").select("id, nome_curto, grupo_id").order("nome_curto"),
        uid ? supabase.from("perfis_grupos").select("grupo_id").eq("perfil_id", uid) : Promise.resolve({ data: null }),
        uid ? supabase.from("perfis_empresas").select("empresa_id").eq("perfil_id", uid) : Promise.resolve({ data: null }),
        uid ? supabase.from("perfis_categorias").select("categoria_descricao").eq("perfil_id", uid) : Promise.resolve({ data: null }),
      ]);
      const gruposAll = resGrupos.data || [];
      const empresasAll = resEmpresas.data || [];
      const pg = (resPG.data || []) as { grupo_id: string }[];
      const pe = (resPE.data || []) as { empresa_id: string }[];
      const pc = (resPC.data || []) as { categoria_descricao: string }[];
      setAllowedGrupoIds(pg.length ? new Set(pg.map((r) => r.grupo_id)) : new Set());
      setAllowedEmpresaIds(pe.length ? new Set(pe.map((r) => r.empresa_id)) : new Set());
      setAllowedCategorias(
        pc.length ? new Set(pc.map((r) => (r.categoria_descricao || "").trim())) : new Set()
      );
      const grupoIds = pg.length ? new Set(pg.map((r) => r.grupo_id)) : null;
      const empresaIds = pe.length ? new Set(pe.map((r) => r.empresa_id)) : null;
      setGrupos(grupoIds ? gruposAll.filter((g) => grupoIds.has(g.id)) : gruposAll);
      const empresasFiltro =
        grupoIds && empresaIds
          ? empresasAll.filter((e) => e.grupo_id != null && grupoIds.has(e.grupo_id) || empresaIds.has(e.id))
          : grupoIds
            ? empresasAll.filter((e) => e.grupo_id != null && grupoIds.has(e.grupo_id))
            : empresaIds
              ? empresasAll.filter((e) => empresaIds.has(e.id))
              : empresasAll;
      setEmpresas(empresasFiltro);
      setLoading(false);
    })();
  }, []);

  const empresasFiltradas =
    grupoId
      ? empresas.filter((e) => e.grupo_id === grupoId)
      : empresas;

  const empresaSelecionada = empresasFiltradas.find((e) => e.id === empresaId);
  const nomesCurtosGrupo = empresasFiltradas.map((e) => e.nome_curto);
  const deveCarregar = !!grupoId;
  const contextEmpresaIds: string[] =
    !grupoId ? [] : empresaSelecionada ? [empresaSelecionada.id] : empresasFiltradas.map((e) => e.id);

  useEffect(() => {
    if (!deveCarregar) {
      setDados([]);
      return;
    }
    if (nomesCurtosGrupo.length === 0) {
      setDados([]);
      setLoadingDados(false);
      return;
    }
    let cancelled = false;
    setLoadingDados(true);
    let q = supabase
      .from("view_dashboard_receber")
      .select("*")
      .order("det_ddtprevisao", { ascending: true });
    if (empresaSelecionada) {
      q = q.eq("empresa", empresaSelecionada.nome_curto);
    } else {
      q = q.in("empresa", nomesCurtosGrupo);
    }
    q.then(({ data, error }) => {
      if (cancelled) return;
      setLoadingDados(false);
      if (error) {
        console.error(error);
        setDados([]);
        return;
      }
      setDados(data || []);
    });
    return () => {
      cancelled = true;
    };
  }, [deveCarregar, empresaSelecionada?.nome_curto, nomesCurtosGrupo.join(","), refreshTrigger]);

  const dadosVisiveis = useMemo(
    () =>
      allowedCategorias.size > 0
        ? dados.filter((r) => allowedCategorias.has((r.categoria_descricao ?? "").trim()))
        : dados,
    [dados, allowedCategorias]
  );

  useEffect(() => {
    const chaves = Array.from(new Set(dadosVisiveis.map((r) => r.chave_cliente).filter(Boolean))) as string[];
    if (chaves.length === 0) {
      setStatusDashboard({});
      return;
    }
    supabase.rpc("expirar_negociados").then(() => {
      supabase
        .from("cliente_status")
        .select("chave_cliente, status, data_negociado")
        .in("chave_cliente", chaves)
        .then(({ data }) => {
          const map: Record<string, { status: string; data_negociado: string | null }> = {};
          (data || []).forEach((r: { chave_cliente: string; status: string; data_negociado: string | null }) => {
            map[r.chave_cliente] = { status: r.status, data_negociado: r.data_negociado ?? null };
          });
          setStatusDashboard(map);
        });
    });
  }, [dadosVisiveis]);

  function chaveContato(cod: string | null, cnpjCpf: string | null): string {
    const codNorm = (cod ?? "").trim().toLowerCase();
    const cnpjNorm = (cnpjCpf ?? "").replace(/\D/g, "");
    return `${codNorm}|${cnpjNorm}`;
  }

  useEffect(() => {
    if (!grupoId) {
      setUltimoContatoPorChave({});
      return;
    }
    let q = supabase
      .from("cobrancas_realizadas")
      .select("cod_cliente, cnpj_cpf, data_contato, created_at")
      .eq("grupo_id", grupoId);
    if (empresaSelecionada) {
      q = q.eq("empresa_id", empresaSelecionada.id);
    }
    q.then(({ data, error }) => {
      if (error) {
        setUltimoContatoPorChave({});
        return;
      }
      const map: Record<string, string> = {};
      (data || []).forEach((r: { cod_cliente: string | null; cnpj_cpf: string | null; data_contato: string | null; created_at: string }) => {
        const key = chaveContato(r.cod_cliente, r.cnpj_cpf);
        const dataRef = r.data_contato || (r.created_at ? r.created_at.slice(0, 10) : null);
        if (!dataRef) return;
        const prev = map[key];
        if (!prev || dataRef > prev) map[key] = dataRef;
      });
      setUltimoContatoPorChave(map);
    });
  }, [grupoId, empresaSelecionada?.id]);

  function handleGrupoChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setGrupoId(e.target.value);
    setEmpresaId("");
  }

  async function forcarAtualizacaoView() {
    setAtualizandoView(true);
    const { error } = await supabase.rpc("refresh_dashboard_receber");
    setAtualizandoView(false);
    if (error) {
      console.error(error);
      alert("Erro ao atualizar a base de dados. Tente novamente.");
      return;
    }
    setRefreshTrigger((t) => t + 1);
  }

  type GrupoItem = {
    key: string;
    emissao: string | null;
    previsao: string | null;
    cliente: string | null;
    codigo: string | null;
    tag_top_40: string | null;
    grupo_empresas: string | null;
    dias: number | null;
    valPago: number;
    valAberto: number;
    valAtualizado: number;
    rows: DashboardRow[];
  };

  const dadosAgrupados: GrupoItem[] = (() => {
    const map = new Map<string, GrupoItem>();
    for (const r of dadosVisiveis) {
      // Agrupar somente por cliente/código, sem segregar por empresa
      const key = `${r.nome_fantasia ?? ""}|${r.codigo_nome_fantasia ?? ""}`;
      const existing = map.get(key);
      const vp = r.ValPago_validado ?? 0;
      const va = r.ValAberto_validado ?? 0;
      const vAtual = valorAtualizado(r.ValAberto_validado, r.qtde_dias) ?? 0;
      if (existing) {
        existing.valPago += vp;
        existing.valAberto += va;
        existing.valAtualizado += vAtual;
        existing.rows.push(r);
      } else {
        map.set(key, {
          key,
          emissao: r.det_ddtemissao,
          previsao: r.det_ddtprevisao,
          cliente: r.nome_fantasia,
          codigo: r.codigo_nome_fantasia,
          tag_top_40: r.tag_top_40 ?? null,
          grupo_empresas: r.grupo_empresas ?? null,
          dias: r.qtde_dias,
          valPago: vp,
          valAberto: va,
          valAtualizado: vAtual,
          rows: [r],
        });
      }
    }
    return Array.from(map.values());
  })();

  const buscaNorm = buscaCliente.trim().toLowerCase();
  const dadosFiltrados = buscaNorm
    ? dadosAgrupados.filter(
        (g) =>
          (g.cliente ?? "").toLowerCase().includes(buscaNorm) ||
          (g.codigo ?? "").toLowerCase().includes(buscaNorm) ||
          (g.grupo_empresas ?? "").toLowerCase().includes(buscaNorm)
      )
    : dadosAgrupados;

  const dadosFiltradosPorStatus = useMemo(() => {
    if (!filtroStatus) return dadosFiltrados;
    return dadosFiltrados.filter((g) => {
      const chave = g.rows[0]?.chave_cliente;
      const info = chave ? (statusPorChave[chave] ?? statusDashboard[chave]) : null;
      const s = info?.status ?? "em_cobranca";
      return s === filtroStatus;
    });
  }, [dadosFiltrados, filtroStatus, statusDashboard, statusPorChave]);

  const totaisColunas = useMemo(
    () =>
      dadosFiltradosPorStatus.reduce(
        (acc, g) => {
          acc.valPago += g.valPago;
          acc.valAberto += g.valAberto;
          acc.valAtualizado += g.valAtualizado;
          return acc;
        },
        { valPago: 0, valAberto: 0, valAtualizado: 0 }
      ),
    [dadosFiltradosPorStatus]
  );

  const resumoPorStatus = useMemo(() => {
    const map = new Map<
      string,
      {
        value: string;
        label: string;
        total: number;
      }
    >();

    // Quadro resumo: usa todos os dados agrupados (independente de filtros de busca/status),
    // respeitando apenas grupo/empresa/categorias carregados.
    for (const g of dadosAgrupados) {
      const chave = g.rows[0]?.chave_cliente;
      const info = chave ? (statusPorChave[chave] ?? statusDashboard[chave]) : null;
      const statusValue = info?.status ?? "em_cobranca";
      const opt = STATUS_OPCOES.find((o) => o.value === statusValue);
      const label = opt?.label ?? statusValue;
      const existing = map.get(statusValue);
      if (existing) {
        existing.total += g.valAtualizado;
      } else {
        map.set(statusValue, { value: statusValue, label, total: g.valAtualizado });
      }
    }

    const items = Array.from(map.values());
    // ordenar pela ordem de STATUS_OPCOES
    items.sort((a, b) => {
      const ia = STATUS_OPCOES.findIndex((o) => o.value === a.value);
      const ib = STATUS_OPCOES.findIndex((o) => o.value === b.value);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
    return items;
  }, [dadosAgrupados, statusDashboard, statusPorChave]);

  const dadosOrdenados = [...dadosFiltradosPorStatus].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "cod") {
      cmp = (a.codigo ?? "").localeCompare(b.codigo ?? "");
    } else if (sortCol === "cliente") {
      cmp = (a.cliente ?? "").localeCompare(b.cliente ?? "");
    } else if (sortCol === "valPago") {
      cmp = a.valPago - b.valPago;
    } else if (sortCol === "valAtualizado") {
      cmp = a.valAtualizado - b.valAtualizado;
    } else {
      cmp = a.valAberto - b.valAberto;
    }
    return sortAsc ? cmp : -cmp;
  });

  function exportarDashboardExcel() {
    const header = [
      "Nome fantasia",
      "Razão social",
      "Grupo",
      "Cód.",
      "CNPJ/CPF",
      "Nota fiscal",
      "Data de vencimento",
      "Status",
      "Data último contato",
      "Top 40",
      "Val. Pago",
      "Val. Aberto",
      "Val. Atualizado",
    ];
    const data: (string | number)[][] = [header];
    for (const g of dadosOrdenados) {
      for (const r of g.rows) {
        const chave = r.chave_cliente;
        const info = chave ? (statusPorChave[chave] ?? statusDashboard[chave]) : null;
        const statusLabel = info ? (STATUS_OPCOES.find((o) => o.value === info.status)?.label ?? info.status) : "Em cobrança";
        const dataNeg = info?.status === "negociado_pagamento" && info?.data_negociado ? String(info.data_negociado).slice(0, 10) : "";
        const statusTexto = dataNeg ? `${statusLabel} (${dataNeg})` : statusLabel;
        const dataPrevisao = r.det_ddtprevisao ? new Date(r.det_ddtprevisao).toLocaleDateString("pt-BR") : "";
        const keyContato = chaveContato(r.codigo_nome_fantasia, r.cnpj_cpf);
        const dataUltimoContato = ultimoContatoPorChave[keyContato]
          ? new Date(ultimoContatoPorChave[keyContato]).toLocaleDateString("pt-BR", { dateStyle: "short" })
          : "";
        const valAtualizado = valorAtualizado(r.ValAberto_validado, r.qtde_dias);
        data.push([
          r.nome_fantasia ?? "",
          r.razao_social ?? "",
          r.grupo_empresas ?? "",
          r.codigo_nome_fantasia ?? "",
          r.cnpj_cpf ?? "",
          r.det_cnumdocfiscal ?? "",
          dataPrevisao,
          statusTexto,
          dataUltimoContato,
          r.tag_top_40 ?? "",
          r.ValPago_validado ?? 0,
          r.ValAberto_validado ?? 0,
          valAtualizado ?? 0,
        ]);
      }
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dashboard");
    const nomeArquivo = `dashboard-receber-${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
  }

  type PopupState =
    | { tipo: "cliente"; key: string }
    | { tipo: "grupo"; grupo: string }
    | null;
  const [popupAberto, setPopupAberto] = useState<PopupState>(null);
  const [emailPopupAberto, setEmailPopupAberto] = useState(false);
  const [emailsDestinatarios, setEmailsDestinatarios] = useState<string[]>([]);
  const [assuntoEmail, setAssuntoEmail] = useState(ASSUNTO_PADRAO);
  const [mensagemEmail, setMensagemEmail] = useState(MENSAGEM_PADRAO);
  const [configEmailLista, setConfigEmailLista] = useState<{ id: string; sender_name: string; sender_mailbox: string }[]>([]);
  const [configEmailId, setConfigEmailId] = useState("");
  const [loadingEmails, setLoadingEmails] = useState(false);
  const [enviandoEmail, setEnviandoEmail] = useState(false);
  const [emailSucesso, setEmailSucesso] = useState<string | null>(null);
  const [emailErro, setEmailErro] = useState<string | null>(null);

  const [ligacaoPopupAberto, setLigacaoPopupAberto] = useState(false);
  const [ligacaoFoiAtendido, setLigacaoFoiAtendido] = useState<boolean | null>(null);
  const [ligacaoNomePessoa, setLigacaoNomePessoa] = useState("");
  const [ligacaoCargoPessoa, setLigacaoCargoPessoa] = useState("");
  const [ligacaoHouveNegociacao, setLigacaoHouveNegociacao] = useState<boolean | null>(null);
  const [ligacaoObservacaoNaoNegociacao, setLigacaoObservacaoNaoNegociacao] = useState("");
  const [ligacaoDataPrevista, setLigacaoDataPrevista] = useState("");
  const [ligacaoHouveDesconto, setLigacaoHouveDesconto] = useState<boolean | null>(null);
  const [ligacaoValorDesconto, setLigacaoValorDesconto] = useState("");
  const [ligacaoMotivoDesconto, setLigacaoMotivoDesconto] = useState("");
  const [ligacaoObservacao, setLigacaoObservacao] = useState("");
  const [ligacaoDataContato, setLigacaoDataContato] = useState("");
  const [ligacaoTelefone, setLigacaoTelefone] = useState("");
  const [ligacaoTelefoneTipo, setLigacaoTelefoneTipo] = useState<"celular" | "fixo" | null>(null);
  const [ligacaoSalvando, setLigacaoSalvando] = useState(false);
  const [ligacaoSucesso, setLigacaoSucesso] = useState<string | null>(null);

  const [whatsappPopupAberto, setWhatsappPopupAberto] = useState(false);
  const [whatsappMensagemEnviada, setWhatsappMensagemEnviada] = useState("");
  const [whatsappObservacao, setWhatsappObservacao] = useState("");
  const [whatsappHouveNegociacao, setWhatsappHouveNegociacao] = useState<boolean | null>(null);
  const [whatsappDataPrevista, setWhatsappDataPrevista] = useState("");
  const [whatsappNomeConversou, setWhatsappNomeConversou] = useState("");
  const [whatsappCargoConversou, setWhatsappCargoConversou] = useState("");
  const [whatsappDataContato, setWhatsappDataContato] = useState("");
  const [whatsappTelefone, setWhatsappTelefone] = useState("");
  const [whatsappTelefoneTipo, setWhatsappTelefoneTipo] = useState<"celular" | "fixo" | null>(null);
  const [whatsappSalvando, setWhatsappSalvando] = useState(false);
  const [whatsappSucesso, setWhatsappSucesso] = useState<string | null>(null);

  const hojeStr = new Date().toISOString().slice(0, 10);

  const [statusModalAberto, setStatusModalAberto] = useState(false);
  const [statusEscolhido, setStatusEscolhido] = useState<string>("em_cobranca");
  const [statusDataNegociado, setStatusDataNegociado] = useState("");
  const [statusEscopoPendente, setStatusEscopoPendente] = useState(false);
  const [statusAplicarGrupo, setStatusAplicarGrupo] = useState<boolean | null>(null);
  const [statusSalvando, setStatusSalvando] = useState(false);
  const [statusErro, setStatusErro] = useState<string | null>(null);
  const [statusSucesso, setStatusSucesso] = useState<string | null>(null);

  const clienteSelecionado =
    popupAberto?.tipo === "cliente"
      ? dadosAgrupados.find((g) => g.key === popupAberto.key)
      : null;
  const detalheRows = clienteSelecionado?.rows ?? [];

  const grupoPopupSelecionado =
    popupAberto?.tipo === "grupo" ? popupAberto.grupo : null;
  const clientesDoGrupo =
    grupoPopupSelecionado
      ? dadosAgrupados.filter(
          (g) => (g.grupo_empresas ?? "").toLowerCase() === grupoPopupSelecionado.toLowerCase()
        )
      : [];
  const totalGrupo = clientesDoGrupo.reduce(
    (acc, g) => ({
      valPago: acc.valPago + g.valPago,
      valAberto: acc.valAberto + g.valAberto,
      valAtualizado: acc.valAtualizado + g.valAtualizado,
    }),
    { valPago: 0, valAberto: 0, valAtualizado: 0 }
  );
  const movimentosDoGrupo: DashboardRow[] =
    clientesDoGrupo.flatMap((c) => c.rows);

  async function abrirEmailPopup() {
    setEmailPopupAberto(true);
    setAssuntoEmail(ASSUNTO_PADRAO);
    setMensagemEmail(MENSAGEM_PADRAO);
    setEmailSucesso(null);
    setEmailErro(null);
    setLoadingEmails(true);
    setEmailsDestinatarios([]);
    const grupoNome = popupAberto?.tipo === "grupo" ? popupAberto.grupo : null;
    if (grupoNome) {
      setAssuntoEmail(ASSUNTO_PADRAO.replace("Grupo 3SA", grupoNome));
      setMensagemEmail(MENSAGEM_PADRAO.replace(/Alldax • Grupo 3SA/g, `Alldax • ${grupoNome}`));
    }
    try {
      let configList: { id: string; sender_name: string; sender_mailbox: string }[] = [];
      if (contextEmpresaIds.length > 0) {
        const { data: vinculos } = await supabase
          .from("config_email_empresas")
          .select("config_email_id")
          .in("empresa_id", contextEmpresaIds);
        const configIds = Array.from(new Set((vinculos || []).map((v) => (v as { config_email_id: string }).config_email_id)));
        if (configIds.length > 0) {
          const { data: configs } = await supabase
            .from("config_email")
            .select("id, sender_name, sender_mailbox")
            .eq("ativo", true)
            .in("id", configIds);
          configList = configs || [];
        }
      }
      const resAcessorias = popupAberto?.tipo === "grupo"
        ? await supabase.from("acessorias").select("id").ilike("grupo_empresas", grupoNome!)
        : { data: null };
      setConfigEmailLista(configList);
      if (configList.length) setConfigEmailId(configList[0].id);
      if (popupAberto?.tipo === "cliente" && detalheRows.length > 0) {
        const primeira = detalheRows[0];
        const { data: mov } = await supabase
          .from("movimentos")
          .select("chave_cliente")
          .eq("id", primeira.movimento_id)
          .single();
        if (mov?.chave_cliente) {
          const { data: cliente } = await supabase
            .from("clientes")
            .select("email")
            .eq("chave_unica", mov.chave_cliente)
            .maybeSingle();
          const list: string[] = [];
          if (cliente?.email) {
            cliente.email.split(/[,;]/).forEach((e: string) => {
              const t = e.trim();
              if (t && !list.includes(t)) list.push(t);
            });
          }
          setEmailsDestinatarios(list);
        }
      } else if (popupAberto?.tipo === "grupo" && resAcessorias?.data?.length) {
        const ids = (resAcessorias.data as { id: string }[]).map((a) => a.id);
        const { data: clientes } = await supabase.from("clientes").select("email").in("acessoria_id", ids);
        const set = new Set<string>();
        for (const c of clientes || []) {
          if (c.email) {
            c.email.split(/[,;]/).forEach((e: string) => {
              const t = e.trim();
              if (t) set.add(t);
            });
          }
        }
        setEmailsDestinatarios(Array.from(set));
      }
    } finally {
      setLoadingEmails(false);
    }
  }

  function abrirStatusModal() {
    setStatusModalAberto(true);
    setStatusEscopoPendente(false);
    setStatusAplicarGrupo(null);
    setStatusErro(null);
    setStatusSucesso(null);
    setStatusEscolhido("em_cobranca");
    setStatusDataNegociado("");
    const chaves: string[] =
      popupAberto?.tipo === "cliente"
        ? Array.from(new Set((detalheRows.map((r) => r.chave_cliente).filter(Boolean) as string[])))
        : Array.from(new Set((movimentosDoGrupo.map((r) => r.chave_cliente).filter(Boolean) as string[])));
    if (chaves.length > 0) {
      supabase
        .from("cliente_status")
        .select("chave_cliente, status, data_negociado")
        .in("chave_cliente", chaves)
        .then(({ data }) => {
          const map: Record<string, { status: string; data_negociado: string | null }> = {};
          (data || []).forEach((r: { chave_cliente: string; status: string; data_negociado: string | null }) => {
            map[r.chave_cliente] = { status: r.status, data_negociado: r.data_negociado ?? null };
          });
          setStatusPorChave(map);
          const primeira = data?.[0];
          if (primeira) {
            setStatusEscolhido(primeira.status);
            setStatusDataNegociado(primeira.data_negociado ? String(primeira.data_negociado).slice(0, 10) : "");
          }
        });
    }
  }

  function confirmarStatusContinuar() {
    const grupoNome =
      popupAberto?.tipo === "cliente" ? clienteSelecionado?.grupo_empresas : null;
    if (popupAberto?.tipo === "cliente" && grupoNome && statusAplicarGrupo === null) {
      setStatusEscopoPendente(true);
      return;
    }
    salvarStatus();
  }

  async function salvarStatus(aplicarTodoGrupo?: boolean) {
    setStatusErro(null);
    setStatusSalvando(true);
    try {
      let chaves: string[] = [];
      if (popupAberto?.tipo === "cliente") {
        if (aplicarTodoGrupo === true || statusAplicarGrupo === true) {
          const grupoNome = (clienteSelecionado?.grupo_empresas ?? "").toLowerCase();
          const doGrupo = dadosAgrupados.filter(
            (g) => (g.grupo_empresas ?? "").toLowerCase() === grupoNome
          );
          chaves = Array.from(new Set(doGrupo.flatMap((c) => c.rows.map((r) => r.chave_cliente).filter(Boolean) as string[])));
        } else {
          chaves = Array.from(new Set(detalheRows.map((r) => r.chave_cliente).filter(Boolean) as string[]));
        }
      } else {
        chaves = Array.from(new Set(movimentosDoGrupo.map((r) => r.chave_cliente).filter(Boolean) as string[]));
      }
      const dataNegociado =
        statusEscolhido === "negociado_pagamento" && statusDataNegociado.trim()
          ? statusDataNegociado.trim()
          : null;
      const { data: { user } } = await supabase.auth.getUser();
      for (const chave of chaves) {
        await supabase.from("cliente_status").upsert(
          {
            chave_cliente: chave,
            status: statusEscolhido,
            data_negociado: dataNegociado,
            updated_at: new Date().toISOString(),
            updated_by: user?.id ?? null,
          },
          { onConflict: "chave_cliente" }
        );
      }
      setStatusSucesso(
        chaves.length === 1
          ? "Status atualizado."
          : `Status atualizado para ${chaves.length} cliente(s).`
      );
      const atual = { status: statusEscolhido, data_negociado: dataNegociado };
      setStatusPorChave((prev) => {
        const next = { ...prev };
        chaves.forEach((k) => { next[k] = atual; });
        return next;
      });
      setStatusDashboard((prev) => {
        const next = { ...prev };
        chaves.forEach((k) => { next[k] = atual; });
        return next;
      });
      setTimeout(() => {
        setStatusModalAberto(false);
        setStatusSucesso(null);
      }, 1500);
    } catch (e) {
      setStatusErro(e instanceof Error ? e.message : "Erro ao salvar status.");
    } finally {
      setStatusSalvando(false);
    }
  }

  async function enviarEmailDashboard() {
    if (!configEmailId || emailsDestinatarios.length === 0) return;
    setEnviandoEmail(true);
    setEmailErro(null);
    setEmailSucesso(null);
    const rows = popupAberto?.tipo === "cliente" ? detalheRows : movimentosDoGrupo;
    const tipo = popupAberto?.tipo ?? "cliente";
    const { data: configEmpresa } = await supabase.from("config_empresa").select("logo_url, background_color").limit(1).maybeSingle();
    const logoUrl = (configEmpresa?.logo_url ?? "").trim() || null;
    const backgroundColor = configEmpresa?.background_color ?? "#FFFFFF";
    const temLogo = !!(logoUrl && (logoUrl.startsWith("http://") || logoUrl.startsWith("https://") || logoUrl.startsWith("data:")));
    const bodyHtml = buildEmailHtml(mensagemEmail, rows, tipo, backgroundColor, temLogo);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setEmailErro("Sessão expirada. Faça login novamente.");
      setEnviandoEmail(false);
      return;
    }
    const cobrancaClientes =
      popupAberto?.tipo === "cliente" && clienteSelecionado
        ? [
            {
              cod_cliente: clienteSelecionado.codigo ?? null,
              cnpj_cpf: detalheRows[0]?.cnpj_cpf ?? null,
              cliente_nome: clienteSelecionado.cliente ?? null,
              grupo_nome: clienteSelecionado.grupo_empresas ?? null,
            },
          ]
        : popupAberto?.tipo === "grupo"
          ? (() => {
              const byCod = new Map<string, { cod_cliente: string | null; cnpj_cpf: string | null; cliente_nome: string | null; grupo_nome: string | null }>();
              for (const g of clientesDoGrupo) {
                const cod = g.codigo ?? "";
                if (cod && !byCod.has(cod))
                  byCod.set(cod, {
                    cod_cliente: g.codigo ?? null,
                    cnpj_cpf: g.rows[0]?.cnpj_cpf ?? null,
                    cliente_nome: g.cliente ?? null,
                    grupo_nome: g.grupo_empresas ?? null,
                  });
              }
              return Array.from(byCod.values());
            })()
          : [];
    const empresasInternasNomes = empresaSelecionada
      ? empresaSelecionada.nome_curto
      : empresasFiltradas.map((e) => e.nome_curto).join(", ");
    const res = await fetch("/api/email/enviar", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        config_email_id: configEmailId,
        empresa_ids: contextEmpresaIds,
        grupo_id: grupoId || null,
        empresa_id: empresaSelecionada?.id || null,
        to_emails: emailsDestinatarios,
        subject: assuntoEmail,
        body_html: bodyHtml,
        logo_url: logoUrl,
        cobranca_clientes: cobrancaClientes,
        empresas_internas_nomes: empresasInternasNomes || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setEmailErro(j.error || res.statusText);
    } else {
      setEmailSucesso(j.message || "E-mail(s) enviado(s).");
    }
    setEnviandoEmail(false);
  }

  function getCobrancaClientesContext(): { cod_cliente: string | null; cnpj_cpf: string | null; cliente_nome: string | null; grupo_nome: string | null }[] {
    if (popupAberto?.tipo === "cliente" && clienteSelecionado)
      return [
        {
          cod_cliente: clienteSelecionado.codigo ?? null,
          cnpj_cpf: detalheRows[0]?.cnpj_cpf ?? null,
          cliente_nome: clienteSelecionado.cliente ?? null,
          grupo_nome: clienteSelecionado.grupo_empresas ?? null,
        },
      ];
    if (popupAberto?.tipo === "grupo") {
      const byCod = new Map<string, { cod_cliente: string | null; cnpj_cpf: string | null; cliente_nome: string | null; grupo_nome: string | null }>();
      for (const g of clientesDoGrupo) {
        const cod = g.codigo ?? "";
        if (cod && !byCod.has(cod))
          byCod.set(cod, {
            cod_cliente: g.codigo ?? null,
            cnpj_cpf: g.rows[0]?.cnpj_cpf ?? null,
            cliente_nome: g.cliente ?? null,
            grupo_nome: g.grupo_empresas ?? null,
          });
      }
      return Array.from(byCod.values());
    }
    return [];
  }

  const empresasInternasNomesStr = empresaSelecionada
    ? empresaSelecionada.nome_curto
    : empresasFiltradas.map((e) => e.nome_curto).join(", ");

  function soNumerosTelefone(s: string): string {
    return (s || "").replace(/\D/g, "");
  }
  function validaTelefone(telefone: string, tipo: "celular" | "fixo" | null): { ok: boolean; msg?: string; valor?: string } {
    const nums = soNumerosTelefone(telefone);
    if (!tipo) return { ok: false, msg: "Informe se o número é celular ou fixo." };
    if (!nums) return { ok: false, msg: "Informe o número de telefone." };
    if (tipo === "celular" && nums.length !== 11) return { ok: false, msg: "Celular deve ter 11 dígitos (DDD + número)." };
    if (tipo === "fixo" && nums.length !== 10) return { ok: false, msg: "Fixo deve ter 10 dígitos (DDD + número)." };
    return { ok: true, valor: nums };
  }

  async function salvarLigacao() {
    const clientes = getCobrancaClientesContext();
    if (clientes.length === 0) return;
    if (ligacaoFoiAtendido === null) return;
    if (!ligacaoDataContato) {
      alert("Informe a data do contato da ligação.");
      return;
    }
    if (ligacaoDataContato > hojeStr) {
      alert("A data do contato não pode ser futura.");
      return;
    }
    const tel = validaTelefone(ligacaoTelefone, ligacaoTelefoneTipo);
    if (!tel.ok) {
      alert(tel.msg);
      return;
    }
    setLigacaoSalvando(true);
    setLigacaoSucesso(null);
    try {
      const registroId = crypto.randomUUID();
      const rows = clientes.map((cliente) => ({
        registro_id: registroId,
        tipo: "ligacao",
        cod_cliente: cliente.cod_cliente,
        cnpj_cpf: cliente.cnpj_cpf,
        cliente_nome: normalizarClienteNome(cliente.cliente_nome),
        grupo_nome: cliente.grupo_nome,
        empresas_internas_nomes: empresasInternasNomesStr || null,
        grupo_id: grupoId || null,
        empresa_id: empresaSelecionada?.id || null,
        data_contato: ligacaoDataContato,
        telefone_contato: tel.valor!,
        telefone_tipo: ligacaoTelefoneTipo!,
        foi_atendido: ligacaoFoiAtendido,
        nome_pessoa: ligacaoFoiAtendido ? (ligacaoNomePessoa.trim() || null) : null,
        cargo_pessoa: ligacaoFoiAtendido ? (ligacaoCargoPessoa.trim() || null) : null,
        houve_negociacao: ligacaoFoiAtendido ? ligacaoHouveNegociacao : null,
        observacao_nao_negociacao: ligacaoFoiAtendido && ligacaoHouveNegociacao === false ? (ligacaoObservacaoNaoNegociacao.trim() || null) : null,
        data_prevista_pagamento: ligacaoFoiAtendido && ligacaoHouveNegociacao === true && ligacaoDataPrevista ? ligacaoDataPrevista : null,
        houve_desconto: ligacaoFoiAtendido && ligacaoHouveNegociacao === true ? ligacaoHouveDesconto : null,
        valor_desconto: ligacaoFoiAtendido && ligacaoHouveNegociacao === true && ligacaoHouveDesconto === true && ligacaoValorDesconto ? (() => { const n = parseFloat(ligacaoValorDesconto.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : null; })() : null,
        motivo_desconto: ligacaoFoiAtendido && ligacaoHouveNegociacao === true && ligacaoHouveDesconto === true ? (ligacaoMotivoDesconto.trim() || null) : null,
        observacao: ligacaoObservacao.trim() || null,
      }));
      const { error } = await supabase.from("cobrancas_realizadas").insert(rows);
      if (error) throw error;
      setLigacaoSucesso("Ligação registrada.");
      setTimeout(() => setLigacaoPopupAberto(false), 1500);
    } catch (e) {
      setLigacaoSucesso(null);
      console.error(e);
      alert("Erro ao registrar ligação. Tente novamente.");
    }
    setLigacaoSalvando(false);
  }

  async function salvarWhatsapp() {
    const clientes = getCobrancaClientesContext();
    if (clientes.length === 0) return;
    if (!whatsappDataContato) {
      alert("Informe a data do contato do WhatsApp.");
      return;
    }
    if (whatsappDataContato > hojeStr) {
      alert("A data do contato não pode ser futura.");
      return;
    }
    const tel = validaTelefone(whatsappTelefone, whatsappTelefoneTipo);
    if (!tel.ok) {
      alert(tel.msg);
      return;
    }
    setWhatsappSalvando(true);
    setWhatsappSucesso(null);
    try {
      const registroId = crypto.randomUUID();
      const rows = clientes.map((cliente) => ({
        registro_id: registroId,
        tipo: "whatsapp",
        cod_cliente: cliente.cod_cliente,
        cnpj_cpf: cliente.cnpj_cpf,
        cliente_nome: normalizarClienteNome(cliente.cliente_nome),
        grupo_nome: cliente.grupo_nome,
        empresas_internas_nomes: empresasInternasNomesStr || null,
        grupo_id: grupoId || null,
        empresa_id: empresaSelecionada?.id || null,
        data_contato: whatsappDataContato,
        telefone_contato: tel.valor!,
        telefone_tipo: whatsappTelefoneTipo!,
        mensagem_whatsapp_enviada: whatsappMensagemEnviada.trim() || null,
        observacao: whatsappObservacao.trim() || null,
        houve_negociacao: whatsappHouveNegociacao,
        data_prevista_pagamento: whatsappHouveNegociacao === true && whatsappDataPrevista ? whatsappDataPrevista : null,
        nome_quem_conversou: whatsappHouveNegociacao === true ? (whatsappNomeConversou.trim() || null) : null,
        cargo_quem_conversou: whatsappHouveNegociacao === true ? (whatsappCargoConversou.trim() || null) : null,
      }));
      const { error } = await supabase.from("cobrancas_realizadas").insert(rows);
      if (error) throw error;
      setWhatsappSucesso("WhatsApp registrado.");
      setTimeout(() => setWhatsappPopupAberto(false), 1500);
    } catch (e) {
      setWhatsappSucesso(null);
      console.error(e);
      alert("Erro ao registrar WhatsApp. Tente novamente.");
    }
    setWhatsappSalvando(false);
  }

  async function gerarRelatorioPdf() {
    const rows = popupAberto?.tipo === "cliente" ? detalheRows : movimentosDoGrupo;
    if (rows.length === 0) return;
    const tipo = popupAberto?.tipo ?? "cliente";

    const { data: configEmpresa } = await supabase
      .from("config_empresa")
      .select("logo_url, background_color")
      .limit(1)
      .maybeSingle();

    const logoUrl = (configEmpresa?.logo_url ?? "").trim() || null;
    const backgroundColor = configEmpresa?.background_color ?? "#FFFFFF";
    const empresasInternasNomes = empresasInternasNomesStr;

    const titulo =
      popupAberto?.tipo === "cliente" && clienteSelecionado
        ? `Relatório — Cliente ${clienteSelecionado.codigo ?? ""} ${clienteSelecionado.cliente ?? ""}`
        : popupAberto?.tipo === "grupo" && grupoPopupSelecionado
        ? `Relatório — Grupo ${grupoPopupSelecionado}`
        : "Relatório";

    const html = buildRelatorioHtml(titulo, rows, tipo, backgroundColor, logoUrl, empresasInternasNomes);
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      w.print();
    }, 500);
  }

  function gerarRelatorioExcel() {
    const rows = popupAberto?.tipo === "cliente" ? detalheRows : movimentosDoGrupo;
    if (rows.length === 0) return;

    const header = [
      "Empresa",
      "Cód. cliente",
      "Cliente",
      "Emissão",
      "Vencimento",
      "Dias",
      "NF",
      "Categoria",
      "Val. Pago",
      "Val. Aberto",
      "Val. Atualizado",
    ];

    const linhas = rows.map((r) => [
      r.empresa ?? "",
      r.codigo_nome_fantasia ?? "",
      r.nome_fantasia ?? "",
      formatarData(r.det_ddtemissao) ?? "",
      // Usa a data exatamente como vem da view (det_ddtprevisao)
      r.det_ddtprevisao ?? "",
      r.qtde_dias ?? "",
      r.det_cnumdocfiscal ?? "",
      r.categoria_descricao ?? "",
      valorParaExcel(r.ValPago_validado),
      valorParaExcel(r.ValAberto_validado),
      valorParaExcel(valorAtualizado(r.ValAberto_validado, r.qtde_dias)),
    ]);

    const conteudo = [header, ...linhas]
      .map((cols) =>
        cols
          .map((c) => {
            const v = String(c ?? "").replace(/"/g, '""');
            return `"${v}"`;
          })
          .join(";")
      )
      .join("\r\n");

    const bom = "\uFEFF";
    const blob = new Blob([bom + conteudo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "relatorio_cobranca.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) return <p className="text-slate-600">Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Relação inadimplentes</h1>
      <p className="text-slate-600 mt-1">
        Contas a Receber — filtre por grupo e empresa
      </p>

      {grupoId && !loadingDados && dadosVisiveis.length > 0 && resumoPorStatus.length > 0 && (
        <div className="mt-4 flex justify-end">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
            <p className="font-semibold text-slate-800 mb-2">
              Resumo por status (Val. Atualizado)
            </p>
            <dl className="space-y-1">
              {resumoPorStatus.map((item) => (
                <div key={item.value} className="flex items-center justify-between">
                  <dt className="text-slate-600">{item.label}</dt>
                  <dd className="font-medium text-slate-900">
                    {formatarMoeda(item.total)}
                  </dd>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-2">
                <dt className="font-semibold text-slate-800">Total</dt>
                <dd className="font-semibold text-slate-900">
                  {formatarMoeda(resumoPorStatus.reduce((s, i) => s + i.total, 0))}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            1. Grupo
          </label>
          <select
            value={grupoId}
            onChange={handleGrupoChange}
            className="px-4 py-2 border rounded bg-white min-w-[200px]"
            required
          >
            <option value="">Selecione o grupo (obrigatório)</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            2. Empresa
          </label>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="px-4 py-2 border rounded bg-white min-w-[200px]"
            disabled={!grupoId}
          >
            <option value="">Todas as empresas do grupo</option>
            {empresasFiltradas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome_curto}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={forcarAtualizacaoView}
          disabled={atualizandoView}
          className="px-4 py-2 rounded bg-slate-600 text-white text-sm font-medium hover:bg-slate-500 disabled:opacity-60"
          title="Atualiza a base de dados da relação (view materializada) com os dados mais recentes de movimentos."
        >
          {atualizandoView ? "Atualizando…" : "Forçar atualização"}
        </button>
      </div>

      {grupoId && !loadingDados && dadosVisiveis.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Buscar cliente
            </label>
            <input
              type="text"
              value={buscaCliente}
              onChange={(e) => setBuscaCliente(e.target.value)}
              placeholder="Nome, código ou grupo..."
              className="px-4 py-2 border rounded bg-white min-w-[200px]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Status
            </label>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="px-4 py-2 border rounded bg-white min-w-[220px]"
            >
              <option value="">Todos os status</option>
              {STATUS_OPCOES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={exportarDashboardExcel}
            className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
          >
            Exportar para Excel
          </button>
        </div>
      )}

      <div className="mt-6">
        {!grupoId ? (
          <p className="text-slate-500">Selecione um grupo para visualizar os dados.</p>
        ) : loadingDados ? (
          <p className="text-slate-600">Carregando dados...</p>
        ) : dadosVisiveis.length === 0 ? (
          <p className="text-slate-500">Nenhum registro encontrado.</p>
        ) : (
          <>
            <div className="mt-2 flex justify-end gap-6 text-sm text-slate-700">
              <span>
                Val. Pago:{" "}
                <strong className="font-semibold">
                  {formatarMoeda(totaisColunas.valPago)}
                </strong>
              </span>
              <span>
                Val. Aberto:{" "}
                <strong className="font-semibold">
                  {formatarMoeda(totaisColunas.valAberto)}
                </strong>
              </span>
              <span>
                Val. Atualizado:{" "}
                <strong className="font-semibold">
                  {formatarMoeda(totaisColunas.valAtualizado)}
                </strong>
              </span>
            </div>
            <div className="overflow-auto max-h-[calc(100vh-16rem)] border rounded mt-4">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-slate-100 shadow-sm">
                  <tr>
                    <th
                      className="text-left p-2 cursor-pointer hover:bg-slate-200 select-none"
                      onClick={() => handleSort("cod")}
                    >
                      Cód. {sortCol === "cod" ? (sortAsc ? "↑" : "↓") : ""}
                    </th>
                    <th
                      className="text-left p-2 cursor-pointer hover:bg-slate-200 select-none"
                      onClick={() => handleSort("cliente")}
                    >
                      Cliente {sortCol === "cliente" ? (sortAsc ? "↑" : "↓") : ""}
                    </th>
                    <th className="text-left p-2">Grupo</th>
                    <th className="text-left p-2">Top 40</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Data último contato</th>
                    <th
                      className="text-right p-2 cursor-pointer hover:bg-slate-200 select-none"
                      onClick={() => handleSort("valPago")}
                    >
                      Val. Pago {sortCol === "valPago" ? (sortAsc ? "↑" : "↓") : ""}
                    </th>
                    <th
                      className="text-right p-2 cursor-pointer hover:bg-slate-200 select-none"
                      onClick={() => handleSort("valAberto")}
                    >
                      Val. Aberto {sortCol === "valAberto" ? (sortAsc ? "↑" : "↓") : ""}
                    </th>
                    <th
                      className="text-right p-2 cursor-pointer hover:bg-slate-200 select-none"
                      onClick={() => handleSort("valAtualizado")}
                    >
                      Val. Atualizado {sortCol === "valAtualizado" ? (sortAsc ? "↑" : "↓") : ""}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {dadosOrdenados.map((g) => {
                    const isClienteSelecionado = popupAberto?.tipo === "cliente" && popupAberto.key === g.key;
                    const isGrupoDestaLinhaSelecionado =
                      popupAberto?.tipo === "grupo" && (g.grupo_empresas ?? "").toLowerCase() === popupAberto.grupo.toLowerCase();
                    const linhaDestacada = isClienteSelecionado || isGrupoDestaLinhaSelecionado;
                    const handleClienteClick = () => {
                      setPopupAberto((prev) =>
                        prev?.tipo === "cliente" && prev.key === g.key ? null : { tipo: "cliente", key: g.key }
                      );
                    };
                    const handleGrupoClick = (e: React.MouseEvent) => {
                      e.stopPropagation();
                      if (!g.grupo_empresas) return;
                      setPopupAberto((prev) =>
                        prev?.tipo === "grupo" && prev.grupo.toLowerCase() === g.grupo_empresas!.toLowerCase()
                          ? null
                          : { tipo: "grupo", grupo: g.grupo_empresas! }
                      );
                    };
                    return (
                      <tr
                        key={g.key}
                        className={`border-t ${linhaDestacada ? "bg-slate-200" : "hover:bg-slate-100"}`}
                      >
                        <td
                          className="p-2 cursor-pointer"
                          onClick={handleClienteClick}
                          title="Clique para ver detalhes do cliente"
                        >
                          {g.codigo || "—"}
                        </td>
                        <td
                          className="p-2 max-w-[220px] truncate cursor-pointer"
                          title={g.cliente || "Clique para ver detalhes do cliente"}
                          onClick={handleClienteClick}
                        >
                          {g.cliente || "—"}
                        </td>
                        <td
                          className={`p-2 max-w-[120px] truncate ${g.grupo_empresas ? "cursor-pointer hover:underline" : ""}`}
                          title={g.grupo_empresas ? "Clique para ver todos os clientes do grupo" : undefined}
                          onClick={handleGrupoClick}
                        >
                          {g.grupo_empresas || "—"}
                        </td>
                        <td
                          className="p-2 cursor-pointer"
                          onClick={handleClienteClick}
                        >
                          {g.tag_top_40 ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                              {g.tag_top_40}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-2" onClick={handleClienteClick}>
                          {(() => {
                            const chave = g.rows[0]?.chave_cliente;
                            const info = chave ? (statusPorChave[chave] ?? statusDashboard[chave]) : null;
                            const statusLabel = info ? (STATUS_OPCOES.find((o) => o.value === info.status)?.label ?? info.status) : "Em cobrança";
                            const dataNeg = info?.status === "negociado_pagamento" && info?.data_negociado ? String(info.data_negociado).slice(0, 10) : null;
                            return (
                              <span className="text-slate-700">
                                {statusLabel}
                                {dataNeg && <span className="text-slate-500 text-xs ml-1">({dataNeg})</span>}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="p-2" onClick={handleClienteClick}>
                          {(() => {
                            const key = chaveContato(g.codigo, g.rows[0]?.cnpj_cpf ?? null);
                            const iso = ultimoContatoPorChave[key];
                            return iso ? new Date(iso).toLocaleDateString("pt-BR", { dateStyle: "short" }) : "—";
                          })()}
                        </td>
                        <td
                          className="p-2 text-right cursor-pointer"
                          onClick={handleClienteClick}
                        >
                          {formatarMoeda(g.valPago)}
                        </td>
                        <td
                          className="p-2 text-right font-medium cursor-pointer"
                          onClick={handleClienteClick}
                        >
                          {formatarMoeda(g.valAberto)}
                        </td>
                        <td
                          className="p-2 text-right font-medium cursor-pointer"
                          onClick={handleClienteClick}
                        >
                          {formatarMoeda(g.valAtualizado)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {dadosOrdenados.length === 0 && dadosAgrupados.length > 0 && (
              <p className="text-slate-500 mt-2">Nenhum cliente encontrado para &quot;{buscaCliente}&quot;</p>
            )}

            {(detalheRows.length > 0 || clientesDoGrupo.length > 0) && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                onClick={() => setPopupAberto(null)}
              >
                <div
                  className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[80vh] overflow-hidden flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-start gap-4 p-4 border-b">
                    <div>
                      {popupAberto?.tipo === "cliente" && clienteSelecionado ? (
                        <>
                          <h3 className="text-lg font-semibold text-slate-800">
                            Detalhe: {clienteSelecionado.cliente || "—"} {clienteSelecionado.codigo ? `(${clienteSelecionado.codigo})` : ""}
                          </h3>
                          {(clienteSelecionado.grupo_empresas || clienteSelecionado.tag_top_40) && (
                            <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-600">
                              {clienteSelecionado.grupo_empresas && (
                                <span>Grupo: {clienteSelecionado.grupo_empresas}</span>
                              )}
                              {clienteSelecionado.tag_top_40 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                                  {clienteSelecionado.tag_top_40}
                                </span>
                              )}
                            </div>
                          )}
                        </>
                      ) : popupAberto?.tipo === "grupo" && grupoPopupSelecionado ? (
                        <h3 className="text-lg font-semibold text-slate-800">
                          Grupo: {grupoPopupSelecionado} — {clientesDoGrupo.length} cliente(s), {movimentosDoGrupo.length} NF(s)
                        </h3>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-4 shrink-0 flex-wrap">
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Registrar contato</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          {hasPermissao("dashboard_enviar_email") && (
                            <button
                              type="button"
                              onClick={abrirEmailPopup}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-slate-700 text-white text-sm hover:bg-slate-600"
                              title="Enviar e-mail"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              Enviar e-mail
                            </button>
                          )}
                          {hasPermissao("dashboard_registrar_ligacao") && (
                            <button
                              type="button"
                              onClick={() => {
                                setLigacaoFoiAtendido(null);
                                setLigacaoNomePessoa("");
                                setLigacaoCargoPessoa("");
                                setLigacaoHouveNegociacao(null);
                                setLigacaoObservacaoNaoNegociacao("");
                                setLigacaoDataPrevista("");
                                setLigacaoHouveDesconto(null);
                                setLigacaoValorDesconto("");
                                setLigacaoMotivoDesconto("");
                                setLigacaoObservacao("");
                                setLigacaoSucesso(null);
                                setLigacaoPopupAberto(true);
                              }}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-emerald-700 text-white text-sm hover:bg-emerald-600"
                              title="Registrar ligação"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                              </svg>
                              Registrar ligação
                            </button>
                          )}
                          {hasPermissao("dashboard_registrar_whatsapp") && (
                            <button
                              type="button"
                              onClick={() => {
                                setWhatsappMensagemEnviada("");
                                setWhatsappObservacao("");
                                setWhatsappHouveNegociacao(null);
                                setWhatsappDataPrevista("");
                                setWhatsappNomeConversou("");
                                setWhatsappCargoConversou("");
                                setWhatsappSucesso(null);
                                setWhatsappPopupAberto(true);
                              }}
                              className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-green-700 text-white text-sm hover:bg-green-600"
                              title="Registrar WhatsApp"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                              </svg>
                              Registrar WhatsApp
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={abrirStatusModal}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-amber-600 text-white text-sm hover:bg-amber-500"
                            title="Alterar status de cobrança"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                            </svg>
                            Alterar status
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">Gerar Relatórios</span>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={gerarRelatorioPdf}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-slate-500 text-white text-sm hover:bg-slate-400"
                            title="Gerar PDF"
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={gerarRelatorioExcel}
                            className="inline-flex items-center gap-2 px-3 py-1.5 rounded bg-amber-600 text-white text-sm hover:bg-amber-500"
                            title="Gerar Excel"
                          >
                            Excel
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => setPopupAberto(null)}
                        className="text-slate-500 hover:text-slate-700 text-2xl leading-none"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <div className="overflow-auto p-4">
                    {popupAberto?.tipo === "cliente" && detalheRows.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="text-left p-2">Empresa</th>
                            <th className="text-left p-2">Emissão</th>
                            <th className="text-left p-2">Vencimento</th>
                            <th className="text-left p-2">Dias</th>
                            <th className="text-left p-2">NF</th>
                            <th className="text-left p-2">Categoria</th>
                            <th className="text-right p-2">Val. Pago</th>
                            <th className="text-right p-2">Val. Aberto</th>
                            <th className="text-right p-2">Val. Atualizado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detalheRows.map((r, i) => (
                            <tr key={`${r.movimento_id}-${i}`} className="border-t">
                              <td className="p-2">{r.empresa || "—"}</td>
                              <td className="p-2">{formatarData(r.det_ddtemissao)}</td>
                              <td className="p-2">{formatarData(r.det_ddtprevisao)}</td>
                              <td className="p-2">{r.qtde_dias ?? "—"}</td>
                              <td className="p-2">{r.det_cnumdocfiscal || "—"}</td>
                              <td className="p-2">{r.categoria_descricao || "—"}</td>
                              <td className="p-2 text-right">{formatarMoeda(r.ValPago_validado)}</td>
                              <td className="p-2 text-right font-medium">{formatarMoeda(r.ValAberto_validado)}</td>
                              <td className="p-2 text-right font-medium">{formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias))}</td>
                            </tr>
                          ))}
                          {clienteSelecionado && (
                            <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                              <td colSpan={5} className="p-2 text-right">Total:</td>
                              <td className="p-2 text-right">{formatarMoeda(clienteSelecionado.valPago)}</td>
                              <td className="p-2 text-right font-medium">{formatarMoeda(clienteSelecionado.valAberto)}</td>
                              <td className="p-2 text-right font-medium">{formatarMoeda(clienteSelecionado.valAtualizado)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    ) : popupAberto?.tipo === "grupo" && movimentosDoGrupo.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="text-left p-2">Cód.</th>
                            <th className="text-left p-2">Cliente</th>
                            <th className="text-left p-2">Empresa</th>
                            <th className="text-left p-2">Emissão</th>
                            <th className="text-left p-2">Vencimento</th>
                            <th className="text-left p-2">Dias</th>
                            <th className="text-left p-2">NF</th>
                            <th className="text-left p-2">Categoria</th>
                            <th className="text-right p-2">Val. Pago</th>
                            <th className="text-right p-2">Val. Aberto</th>
                            <th className="text-right p-2">Val. Atualizado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movimentosDoGrupo.map((r, i) => (
                            <tr key={`${r.movimento_id}-${i}`} className="border-t">
                              <td className="p-2">{r.codigo_nome_fantasia || "—"}</td>
                              <td className="p-2 max-w-[200px] truncate">{r.nome_fantasia || "—"}</td>
                              <td className="p-2">{r.empresa || "—"}</td>
                              <td className="p-2">{formatarData(r.det_ddtemissao)}</td>
                              <td className="p-2">{formatarData(r.det_ddtprevisao)}</td>
                              <td className="p-2">{r.qtde_dias ?? "—"}</td>
                              <td className="p-2">{r.det_cnumdocfiscal || "—"}</td>
                              <td className="p-2">{r.categoria_descricao || "—"}</td>
                              <td className="p-2 text-right">{formatarMoeda(r.ValPago_validado)}</td>
                              <td className="p-2 text-right font-medium">{formatarMoeda(r.ValAberto_validado)}</td>
                              <td className="p-2 text-right font-medium">{formatarMoeda(valorAtualizado(r.ValAberto_validado, r.qtde_dias))}</td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
                            <td colSpan={7} className="p-2 text-right">Total:</td>
                            <td className="p-2 text-right">{formatarMoeda(totalGrupo.valPago)}</td>
                            <td className="p-2 text-right font-medium">{formatarMoeda(totalGrupo.valAberto)}</td>
                            <td className="p-2 text-right font-medium">{formatarMoeda(totalGrupo.valAtualizado)}</td>
                          </tr>
                        </tbody>
                      </table>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {statusModalAberto && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
                onClick={() => !statusSalvando && !statusEscopoPendente && setStatusModalAberto(false)}
              >
                <div
                  className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-semibold text-slate-800">Alterar status de cobrança</h3>
                    {!statusEscopoPendente && (
                      <button
                        type="button"
                        onClick={() => !statusSalvando && setStatusModalAberto(false)}
                        className="text-slate-500 hover:text-slate-700 text-2xl leading-none"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="p-4 space-y-4">
                    {statusSucesso ? (
                      <p className="text-green-700 font-medium">{statusSucesso}</p>
                    ) : statusEscopoPendente ? (
                      <>
                        <p className="text-slate-700">
                          Deseja alterar o status para <strong>este cliente somente</strong> ou para <strong>todas as empresas do grupo {clienteSelecionado?.grupo_empresas ?? ""}</strong>?
                        </p>
                        <div className="flex gap-3 pt-2">
                          <button
                            type="button"
                            onClick={() => salvarStatus(false)}
                            disabled={statusSalvando}
                            className="flex-1 px-4 py-2 rounded bg-slate-600 text-white hover:bg-slate-500 disabled:opacity-50"
                          >
                            {statusSalvando ? "Salvando..." : "Só este cliente"}
                          </button>
                          <button
                            type="button"
                            onClick={() => salvarStatus(true)}
                            disabled={statusSalvando}
                            className="flex-1 px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
                          >
                            {statusSalvando ? "Salvando..." : `Todo o grupo ${clienteSelecionado?.grupo_empresas ?? ""}`}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                          <select
                            value={statusEscolhido}
                            onChange={(e) => setStatusEscolhido(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded"
                          >
                            {STATUS_OPCOES.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {statusEscolhido === "negociado_pagamento" && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Data prevista para pagamento</label>
                            <input
                              type="date"
                              value={statusDataNegociado}
                              onChange={(e) => setStatusDataNegociado(e.target.value)}
                              className="w-full px-3 py-2 border border-slate-300 rounded"
                            />
                          </div>
                        )}
                        {statusErro && (
                          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{statusErro}</p>
                        )}
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => !statusSalvando && setStatusModalAberto(false)}
                            className="px-4 py-2 border rounded hover:bg-slate-100"
                            disabled={statusSalvando}
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={confirmarStatusContinuar}
                            disabled={statusSalvando}
                            className="px-4 py-2 rounded bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50"
                          >
                            {statusSalvando ? "Salvando..." : "Continuar"}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {emailPopupAberto && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
                onClick={() => setEmailPopupAberto(false)}
              >
                <div
                  className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-semibold text-slate-800">Enviar e-mail</h3>
                    <button
                      type="button"
                      onClick={() => setEmailPopupAberto(false)}
                      className="text-slate-500 hover:text-slate-700 text-2xl leading-none"
                    >
                      ×
                    </button>
                  </div>
                  <div className="overflow-auto p-4 space-y-4">
                    {loadingEmails ? (
                      <p className="text-slate-600">Carregando destinatários...</p>
                    ) : (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Destinatários (e-mails do cadastro — clique em × para remover)</label>
                          <div className="min-h-[80px] px-3 py-2 border rounded bg-slate-50 flex flex-wrap gap-2 items-center">
                            {emailsDestinatarios.length === 0 && !loadingEmails && (
                              <span className="text-slate-500 text-sm">Nenhum e-mail. Adicione abaixo ou carregue pelo cliente/grupo.</span>
                            )}
                            {emailsDestinatarios.map((email, idx) => (
                              <span
                                key={`${email}-${idx}`}
                                className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded bg-white border border-slate-200 text-sm"
                              >
                                <span className="max-w-[200px] truncate" title={email}>{email}</span>
                                <button
                                  type="button"
                                  onClick={() => setEmailsDestinatarios((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-slate-400 hover:text-red-600 p-0.5 rounded"
                                  title="Remover destinatário"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                          <p className="text-slate-500 text-xs mt-1">Você pode remover e-mails da lista acima. Para adicionar, use o campo abaixo.</p>
                          <input
                            type="email"
                            placeholder="Adicionar outro e-mail e pressione Enter"
                            className="w-full mt-2 px-3 py-2 border rounded text-sm"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              e.preventDefault();
                              const input = e.currentTarget;
                              const val = input.value.trim();
                              if (val && !emailsDestinatarios.includes(val)) {
                                setEmailsDestinatarios((prev) => [...prev, val]);
                                input.value = "";
                              }
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Configuração de envio</label>
                          <select
                            value={configEmailId}
                            onChange={(e) => setConfigEmailId(e.target.value)}
                            className="w-full px-3 py-2 border rounded"
                          >
                            {configEmailLista.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.sender_name} ({c.sender_mailbox})
                              </option>
                            ))}
                            {configEmailLista.length === 0 && (
                              <option value="">Nenhuma configuração de e-mail para as empresas deste filtro</option>
                            )}
                          </select>
                          {configEmailLista.length === 0 && (
                            <p className="text-amber-700 text-xs mt-1">Cadastre em Configurações → E-mail e vincule às empresas do grupo/empresa selecionado.</p>
                          )}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Assunto</label>
                          <input
                            type="text"
                            value={assuntoEmail}
                            onChange={(e) => setAssuntoEmail(e.target.value)}
                            className="w-full px-3 py-2 border rounded"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Mensagem</label>
                          <textarea
                            value={mensagemEmail}
                            onChange={(e) => setMensagemEmail(e.target.value)}
                            rows={12}
                            className="w-full px-3 py-2 border rounded text-sm"
                          />
                          <p className="text-slate-500 text-xs mt-1">Os dados da tabela do popup serão incluídos automaticamente no final do e-mail.</p>
                        </div>
                        {emailSucesso && (
                          <p className="text-green-700 bg-green-50 px-3 py-2 rounded text-sm">{emailSucesso}</p>
                        )}
                        {emailErro && (
                          <p className="text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{emailErro}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={enviarEmailDashboard}
                            disabled={enviandoEmail || emailsDestinatarios.length === 0 || !configEmailId}
                            className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
                          >
                            {enviandoEmail ? "Enviando..." : "Enviar e-mail"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEmailPopupAberto(false)}
                            className="px-4 py-2 border rounded hover:bg-slate-100"
                          >
                            Fechar
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {ligacaoPopupAberto && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
                onClick={() => setLigacaoPopupAberto(false)}
              >
                <div
                  className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-semibold text-slate-800">Registrar ligação</h3>
                    <button type="button" onClick={() => setLigacaoPopupAberto(false)} className="text-slate-500 hover:text-slate-700 text-2xl leading-none">×</button>
                  </div>
                  <div className="overflow-auto p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Data do contato <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={ligacaoDataContato}
                        max={hojeStr}
                        onChange={(e) => setLigacaoDataContato(e.target.value)}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Tipo de telefone <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-4">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="ligacaoTipoTel" checked={ligacaoTelefoneTipo === "celular"} onChange={() => setLigacaoTelefoneTipo("celular")} className="rounded" />
                          Celular (11 dígitos)
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="ligacaoTipoTel" checked={ligacaoTelefoneTipo === "fixo"} onChange={() => setLigacaoTelefoneTipo("fixo")} className="rounded" />
                          Fixo (10 dígitos)
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Número de telefone <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={ligacaoTelefone}
                        onChange={(e) => setLigacaoTelefone(soNumerosTelefone(e.target.value))}
                        placeholder="Ex: 61999999999"
                        maxLength={11}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Foi atendido?</label>
                      <div className="flex gap-4">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="foiAtendido" checked={ligacaoFoiAtendido === true} onChange={() => setLigacaoFoiAtendido(true)} className="rounded" />
                          Sim
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="foiAtendido" checked={ligacaoFoiAtendido === false} onChange={() => setLigacaoFoiAtendido(false)} className="rounded" />
                          Não
                        </label>
                      </div>
                    </div>
                    {ligacaoFoiAtendido === true && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Nome da pessoa que falou</label>
                          <input type="text" value={ligacaoNomePessoa} onChange={(e) => setLigacaoNomePessoa(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="Nome" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Cargo da pessoa</label>
                          <input type="text" value={ligacaoCargoPessoa} onChange={(e) => setLigacaoCargoPessoa(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="Cargo" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Houve negociação?</label>
                          <div className="flex gap-4">
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="houveNegLig" checked={ligacaoHouveNegociacao === true} onChange={() => setLigacaoHouveNegociacao(true)} className="rounded" />
                              Sim
                            </label>
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="houveNegLig" checked={ligacaoHouveNegociacao === false} onChange={() => setLigacaoHouveNegociacao(false)} className="rounded" />
                              Não
                            </label>
                          </div>
                        </div>
                        {ligacaoHouveNegociacao === false && (
                          <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Observação (motivo de não negociação)</label>
                            <textarea value={ligacaoObservacaoNaoNegociacao} onChange={(e) => setLigacaoObservacaoNaoNegociacao(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded text-sm" placeholder="Motivo" />
                          </div>
                        )}
                        {ligacaoHouveNegociacao === true && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Data prevista de pagamento</label>
                              <input type="date" value={ligacaoDataPrevista} onChange={(e) => setLigacaoDataPrevista(e.target.value)} className="w-full px-3 py-2 border rounded" />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Houve desconto?</label>
                              <div className="flex gap-4">
                                <label className="inline-flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="houveDesc" checked={ligacaoHouveDesconto === true} onChange={() => setLigacaoHouveDesconto(true)} className="rounded" />
                                  Sim
                                </label>
                                <label className="inline-flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="houveDesc" checked={ligacaoHouveDesconto === false} onChange={() => setLigacaoHouveDesconto(false)} className="rounded" />
                                  Não
                                </label>
                              </div>
                            </div>
                            {ligacaoHouveDesconto === true && (
                              <>
                                <div>
                                  <label className="block text-sm font-medium text-slate-700 mb-1">Valor do desconto (R$)</label>
                                  <input type="text" value={ligacaoValorDesconto} onChange={(e) => setLigacaoValorDesconto(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="Ex: 1.500,50" />
                                </div>
                                <div>
                                  <label className="block text-sm font-medium text-slate-700 mb-1">Motivo do desconto</label>
                                  <input type="text" value={ligacaoMotivoDesconto} onChange={(e) => setLigacaoMotivoDesconto(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="Motivo" />
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Observação</label>
                      <textarea value={ligacaoObservacao} onChange={(e) => setLigacaoObservacao(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded text-sm" placeholder="Qualquer observação" />
                    </div>
                    {ligacaoSucesso && <p className="text-green-700 bg-green-50 px-3 py-2 rounded text-sm">{ligacaoSucesso}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={salvarLigacao}
                        disabled={
                          ligacaoFoiAtendido === null ||
                          ligacaoSalvando ||
                          !ligacaoDataContato ||
                          !ligacaoTelefoneTipo ||
                          !ligacaoTelefone.trim() ||
                          (ligacaoTelefoneTipo === "celular" && soNumerosTelefone(ligacaoTelefone).length !== 11) ||
                          (ligacaoTelefoneTipo === "fixo" && soNumerosTelefone(ligacaoTelefone).length !== 10)
                        }
                        className="px-4 py-2 bg-emerald-700 text-white rounded hover:bg-emerald-600 disabled:opacity-50"
                      >
                        {ligacaoSalvando ? "Salvando..." : "Salvar"}
                      </button>
                      <button type="button" onClick={() => setLigacaoPopupAberto(false)} className="px-4 py-2 border rounded hover:bg-slate-100">Fechar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {whatsappPopupAberto && (
              <div
                className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
                onClick={() => setWhatsappPopupAberto(false)}
              >
                <div
                  className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex justify-between items-center p-4 border-b">
                    <h3 className="text-lg font-semibold text-slate-800">Registrar WhatsApp</h3>
                    <button type="button" onClick={() => setWhatsappPopupAberto(false)} className="text-slate-500 hover:text-slate-700 text-2xl leading-none">×</button>
                  </div>
                  <div className="overflow-auto p-4 space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Data do contato <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        value={whatsappDataContato}
                        max={hojeStr}
                        onChange={(e) => setWhatsappDataContato(e.target.value)}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Tipo de telefone <span className="text-red-500">*</span>
                      </label>
                      <div className="flex gap-4">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="whatsappTipoTel" checked={whatsappTelefoneTipo === "celular"} onChange={() => setWhatsappTelefoneTipo("celular")} className="rounded" />
                          Celular (11 dígitos)
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="whatsappTipoTel" checked={whatsappTelefoneTipo === "fixo"} onChange={() => setWhatsappTelefoneTipo("fixo")} className="rounded" />
                          Fixo (10 dígitos)
                        </label>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Número de telefone <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={whatsappTelefone}
                        onChange={(e) => setWhatsappTelefone(soNumerosTelefone(e.target.value))}
                        placeholder="Ex: 61999999999"
                        maxLength={11}
                        className="w-full px-3 py-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Mensagem do WhatsApp</label>
                      <p className="text-slate-500 text-xs mb-1">Informe que a mensagem foi enviada</p>
                      <textarea value={whatsappMensagemEnviada} onChange={(e) => setWhatsappMensagemEnviada(e.target.value)} rows={2} className="w-full px-3 py-2 border rounded text-sm" placeholder="Ex: Mensagem enviada com aviso de pendências" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Observações (resumo do que foi negociado)</label>
                      <textarea value={whatsappObservacao} onChange={(e) => setWhatsappObservacao(e.target.value)} rows={3} className="w-full px-3 py-2 border rounded text-sm" placeholder="Resumir o que foi combinado na conversa" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Houve negociação?</label>
                      <div className="flex gap-4">
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="houveNegWa" checked={whatsappHouveNegociacao === true} onChange={() => setWhatsappHouveNegociacao(true)} className="rounded" />
                          Sim
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="houveNegWa" checked={whatsappHouveNegociacao === false} onChange={() => setWhatsappHouveNegociacao(false)} className="rounded" />
                          Não
                        </label>
                      </div>
                    </div>
                    {whatsappHouveNegociacao === true && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Data prevista de pagamento</label>
                          <input type="date" value={whatsappDataPrevista} onChange={(e) => setWhatsappDataPrevista(e.target.value)} className="w-full px-3 py-2 border rounded" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Nome de quem conversou</label>
                          <input type="text" value={whatsappNomeConversou} onChange={(e) => setWhatsappNomeConversou(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="Nome" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Cargo</label>
                          <input type="text" value={whatsappCargoConversou} onChange={(e) => setWhatsappCargoConversou(e.target.value)} className="w-full px-3 py-2 border rounded" placeholder="Cargo" />
                        </div>
                      </>
                    )}
                    {whatsappSucesso && <p className="text-green-700 bg-green-50 px-3 py-2 rounded text-sm">{whatsappSucesso}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={salvarWhatsapp}
                        disabled={
                          whatsappSalvando ||
                          !whatsappDataContato ||
                          !whatsappTelefoneTipo ||
                          !whatsappTelefone.trim() ||
                          (whatsappTelefoneTipo === "celular" && soNumerosTelefone(whatsappTelefone).length !== 11) ||
                          (whatsappTelefoneTipo === "fixo" && soNumerosTelefone(whatsappTelefone).length !== 10)
                        }
                        className="px-4 py-2 bg-green-700 text-white rounded hover:bg-green-600 disabled:opacity-50"
                      >
                        {whatsappSalvando ? "Salvando..." : "Salvar"}
                      </button>
                      <button type="button" onClick={() => setWhatsappPopupAberto(false)} className="px-4 py-2 border rounded hover:bg-slate-100">Fechar</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
