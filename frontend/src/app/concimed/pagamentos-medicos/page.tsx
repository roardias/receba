"use client";

import { useEffect, useState, useMemo } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type ViewRow = {
  empresa: string;
  chave_cliente: string | null;
  razao_social: string;
  cnpj_cpf_apenas_numeros: string;
  ano: number;
  mes: number;
  valor_pago_corrigido: number;
  valor_responsavel_tecnico?: number;
};

/** Uma linha lógica na grade após separar repasse vs responsável técnico vs total */
type TipoLinhaPagamento = "repasse_medico" | "responsavel_tecnico" | "total_combinado";

type ClienteLinha = {
  empresa: string;
  chave_cliente: string | null;
  razao_social: string;
  cnpj_cpf_apenas_numeros: string;
  valor_total: number;
  porMes: Map<string, number>;
  tipoLinha: TipoLinhaPagamento;
  tipoLabel: string;
};

type AgregadoPagamentosCliente = {
  empresa: string;
  chave_cliente: string | null;
  razao_social: string;
  cnpj_cpf_apenas_numeros: string;
  porMesRepasse: Map<string, number>;
  porMesRt: Map<string, number>;
};

const ORDEM_TIPO_LINHA: Record<TipoLinhaPagamento, number> = {
  repasse_medico: 0,
  responsavel_tecnico: 1,
  total_combinado: 2,
};

function somaMapValores(m: Map<string, number>): number {
  let s = 0;
  m.forEach((v) => {
    s += Number(v) || 0;
  });
  return s;
}

function agregadoParaLinhasExibicao(agg: AgregadoPagamentosCliente): ClienteLinha[] {
  const somaRepasse = somaMapValores(agg.porMesRepasse);
  const somaRt = somaMapValores(agg.porMesRt);
  const temRepasse = somaRepasse > 0;
  const temRt = somaRt > 0;
  const base = {
    empresa: agg.empresa,
    chave_cliente: agg.chave_cliente,
    razao_social: agg.razao_social,
    cnpj_cpf_apenas_numeros: agg.cnpj_cpf_apenas_numeros,
  };

  if (temRepasse && !temRt) {
    return [
      {
        ...base,
        tipoLinha: "repasse_medico",
        tipoLabel: "Repasse Médico",
        valor_total: somaRepasse,
        porMes: new Map(agg.porMesRepasse),
      },
    ];
  }
  if (!temRepasse && temRt) {
    return [
      {
        ...base,
        tipoLinha: "responsavel_tecnico",
        tipoLabel: "Responsável Técnico",
        valor_total: somaRt,
        porMes: new Map(agg.porMesRt),
      },
    ];
  }
  if (temRepasse && temRt) {
    const porMesTotal = new Map<string, number>();
    const meses = new Set([
      ...Array.from(agg.porMesRepasse.keys()),
      ...Array.from(agg.porMesRt.keys()),
    ]);
    meses.forEach((km) => {
      porMesTotal.set(km, (agg.porMesRepasse.get(km) ?? 0) + (agg.porMesRt.get(km) ?? 0));
    });
    return [
      {
        ...base,
        tipoLinha: "repasse_medico",
        tipoLabel: "Repasse Médico",
        valor_total: somaRepasse,
        porMes: new Map(agg.porMesRepasse),
      },
      {
        ...base,
        tipoLinha: "responsavel_tecnico",
        tipoLabel: "Responsável Técnico",
        valor_total: somaRt,
        porMes: new Map(agg.porMesRt),
      },
      {
        ...base,
        tipoLinha: "total_combinado",
        tipoLabel: "Total",
        valor_total: somaRepasse + somaRt,
        porMes: porMesTotal,
      },
    ];
  }
  return [];
}

/** Mesma razão social + mesmo documento (CPF/CNPJ) = um bloco visual na grade. */
function chaveNomeCpfLinha(l: ClienteLinha): string {
  const nome = (l.razao_social || "").trim().toLowerCase();
  const doc = String(l.cnpj_cpf_apenas_numeros || "").replace(/\D/g, "");
  const docNorm =
    doc.length >= 14
      ? doc.padStart(14, "0").slice(-14)
      : doc.length >= 11
        ? doc.padStart(11, "0").slice(-11)
        : doc;
  return `${nome}|${docNorm}`;
}

type MedicoIrRetidoRegistro = {
  nome_medico: string;
  cpf_apenas_numeros: string;
  empresa: string;
  competencia: string;
  valor_ir_retido: number;
};

type IrEdicaoContexto = {
  empresa: string;
  doc: string;
  km: string;
  valorAtual: number;
  razaoSocial: string;
};

const MESES_LABEL = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function formatarMoeda(val: number | null | undefined): string {
  if (val == null || val === 0) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function formatarMoedaIrRetido(val: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
}

function formatarCnpjCpf(apenasNumeros: string | null | undefined): string {
  if (!apenasNumeros || !String(apenasNumeros).trim()) return "—";
  const n = String(apenasNumeros).replace(/\D/g, "");
  if (n.length <= 11) {
    return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

function apenasNumeros(termo: string): string {
  return String(termo || "").replace(/\D/g, "");
}

function chaveMes(ano: number, mes: number): string {
  return `${ano}_${String(mes).padStart(2, "0")}`;
}

/** competencia no banco: 'YYYY-MM-01' → mesma chave das colunas da grade */
function competenciaParaKm(competencia: string | null | undefined): string | null {
  if (!competencia) return null;
  const s = String(competencia).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const ano = parseInt(m[1], 10);
  const mes = parseInt(m[2], 10);
  if (mes < 1 || mes > 12) return null;
  return chaveMes(ano, mes);
}

function chaveIrRetidoCelula(empresa: string, docApenasNumeros: string, km: string): string {
  return `${(empresa || "").trim()}|${docApenasNumeros.replace(/\D/g, "")}|${km}`;
}

/** km tipo 2024_03 → data competência ISO para o banco */
function kmParaCompetenciaIso(km: string): string | null {
  const [ano, mes] = km.split("_").map(Number);
  if (!ano || mes < 1 || mes > 12) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-01`;
}

function labelMes(ano: number, mes: number): string {
  return `${MESES_LABEL[mes - 1]}/${ano}`;
}

function textoParaExcel(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .normalize("NFC")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

function moedaPdf(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Cores das tabelas no PDF (Concimed). */
const PDF_HEAD_FILL: [number, number, number] = [224, 101, 44]; // #E0652C
const PDF_FOOT_FILL: [number, number, number] = [87, 39, 29]; // #57271D
const PDF_HEAD_FOOT_TEXT: [number, number, number] = [255, 255, 255];

/** Logo em `public/concimed/logo.svg` — usada só no PDF. */
const CONCIMED_LOGO_SVG_PATH = "/concimed/logo.svg";

function parseSvgLength(attr: string | null): number {
  if (!attr) return 0;
  const n = parseFloat(String(attr).replace(/px$/i, "").trim());
  return Number.isFinite(n) ? n : 0;
}

/** Converte SVG (mesma origem) em PNG data URL para o jsPDF. Retorna null se o arquivo não existir ou falhar. */
async function carregarLogoConcimedPngDataUrl(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(CONCIMED_LOGO_SVG_PATH);
    if (!res.ok) return null;
    const svgText = await res.text();
    const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const root = parsed.documentElement;
    let w = parseSvgLength(root.getAttribute("width"));
    let h = parseSvgLength(root.getAttribute("height"));
    const vb = root.getAttribute("viewBox");
    if (vb) {
      const p = vb.trim().split(/[\s,]+/).map(Number);
      if (p.length >= 4) {
        if (!w) w = p[2];
        if (!h) h = p[3];
      }
    }
    if (!w || !h) {
      w = 320;
      h = 96;
    }
    const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const objUrl = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("logo svg"));
      img.src = objUrl;
    });
    const canvas = document.createElement("canvas");
    const scale = 2;
    canvas.width = Math.ceil(w * scale);
    canvas.height = Math.ceil(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      URL.revokeObjectURL(objUrl);
      return null;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(objUrl);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

const FORMATO_NUMERO_BR = "#.##0,00";
type OrdenarPor = "razao_social" | "cnpj_cpf" | "total" | `mes:${string}`;

function mesAtualYYYYMM(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Aceita "1234,56" ou "1234.56" ou "1.234,56" → número */
function parseValorMonetarioBr(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const soDigitos = t.replace(/\D/g, "");
  if (!soDigitos) return null;
  if (t.includes(",")) {
    const norm = t.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(norm);
    return Number.isFinite(n) ? n : null;
  }
  const n = parseFloat(t.replace(/\./g, ""));
  return Number.isFinite(n) ? n : null;
}

function documentoValido11ou14(digits: string): boolean {
  const n = digits.replace(/\D/g, "");
  return n.length === 11 || n.length === 14;
}

function IconeCaderneta({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M8 3v18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M11 8h7M11 12h7M11 16h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function PagamentosMedicosPage() {
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  /** Vazio = todos os anos; senão apenas os anos listados (string "2023", "2024", …) */
  const [anosFiltro, setAnosFiltro] = useState<string[]>([]);
  /** Vazio = todas as razões sociais; senão apenas as selecionadas */
  const [razoesSociaisFiltro, setRazoesSociaisFiltro] = useState<string[]>([]);
  const [ordenarPor, setOrdenarPor] = useState<OrdenarPor>("razao_social");
  const [ordemAsc, setOrdemAsc] = useState(true);
  const [atualizandoView, setAtualizandoView] = useState(false);
  const [mensagemView, setMensagemView] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const [irModalLinha, setIrModalLinha] = useState<ClienteLinha | null>(null);
  const [irCompetencia, setIrCompetencia] = useState(mesAtualYYYYMM());
  const [irValor, setIrValor] = useState("");
  const [irSalvando, setIrSalvando] = useState(false);
  const [irErroModal, setIrErroModal] = useState<string | null>(null);
  /** Mapa empresa|doc|km_mês → valor IR retido (medico_ir_retido) */
  const [irRetidoPorCelula, setIrRetidoPorCelula] = useState<Map<string, number>>(() => new Map());
  const [irRetidoRegistros, setIrRetidoRegistros] = useState<MedicoIrRetidoRegistro[]>([]);

  const [irEditarCtx, setIrEditarCtx] = useState<IrEdicaoContexto | null>(null);
  const [irEditarValor, setIrEditarValor] = useState("");
  const [irEditarSalvando, setIrEditarSalvando] = useState(false);
  const [irEditarErro, setIrEditarErro] = useState<string | null>(null);

  const PAGE_SIZE = 1000; // Supabase retorna no máximo 1000 por consulta; buscar em páginas para trazer todos

  function abrirModalIr(l: ClienteLinha) {
    setIrModalLinha(l);
    setIrCompetencia(mesAtualYYYYMM());
    setIrValor("");
    setIrErroModal(null);
  }

  function fecharModalIr() {
    if (irSalvando) return;
    setIrModalLinha(null);
    setIrErroModal(null);
  }

  async function salvarIrRetido() {
    if (!irModalLinha) return;
    setIrErroModal(null);
    const doc = apenasNumeros(irModalLinha.cnpj_cpf_apenas_numeros);
    if (!documentoValido11ou14(doc)) {
      setIrErroModal("CPF/CNPJ deve ter 11 ou 14 dígitos para salvar.");
      return;
    }
    const valorNum = parseValorMonetarioBr(irValor);
    if (valorNum == null || valorNum < 0) {
      setIrErroModal("Informe um valor de IR retido válido (ex.: 1.234,56).");
      return;
    }
    if (!irCompetencia || !/^\d{4}-\d{2}$/.test(irCompetencia)) {
      setIrErroModal("Selecione a competência (mês/ano).");
      return;
    }
    const [y, m] = irCompetencia.split("-").map(Number);
    if (m < 1 || m > 12) {
      setIrErroModal("Mês inválido.");
      return;
    }
    const competencia = `${irCompetencia}-01`;
    const msgConfirm = `Confira novamente o valor: ${formatarMoeda(valorNum)}.\n\nTem certeza que deseja salvar?`;
    if (!window.confirm(msgConfirm)) return;

    setIrSalvando(true);
    try {
      const { error } = await supabase.from("medico_ir_retido").insert({
        nome_medico: (irModalLinha.razao_social || "").trim() || "—",
        cpf_apenas_numeros: doc,
        empresa: (irModalLinha.empresa || "").trim(),
        competencia,
        valor_ir_retido: valorNum,
      });
      if (error) {
        if (error.code === "23505") {
          setIrErroModal("Já existe lançamento para este CPF/CNPJ, empresa e competência.");
        } else if (error.code === "23503") {
          setIrErroModal("Empresa inválida no cadastro (nome curto não encontrado em empresas).");
        } else {
          setIrErroModal(error.message || "Erro ao salvar.");
        }
        return;
      }
      setIrModalLinha(null);
      setIrValor("");
      setMensagemView({ tipo: "ok", texto: "IR retido registrado com sucesso." });
      setTimeout(() => setMensagemView(null), 4000);
      const { map, rows } = await fetchIrRetidoCompleto();
      setIrRetidoPorCelula(map);
      setIrRetidoRegistros(rows);
    } finally {
      setIrSalvando(false);
    }
  }

  function abrirEditarIr(l: ClienteLinha, km: string, valorAtual: number) {
    const doc = apenasNumeros(l.cnpj_cpf_apenas_numeros);
    if (!documentoValido11ou14(doc)) return;
    if (!kmParaCompetenciaIso(km)) return;
    setIrEditarCtx({
      empresa: (l.empresa || "").trim(),
      doc,
      km,
      valorAtual,
      razaoSocial: (l.razao_social || "").trim() || "—",
    });
    setIrEditarValor(
      new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valorAtual)
    );
    setIrEditarErro(null);
  }

  function fecharEditarIr() {
    if (irEditarSalvando) return;
    setIrEditarCtx(null);
    setIrEditarErro(null);
  }

  async function salvarEdicaoIrRetido() {
    if (!irEditarCtx) return;
    setIrEditarErro(null);
    const competencia = kmParaCompetenciaIso(irEditarCtx.km);
    if (!competencia) {
      setIrEditarErro("Competência inválida.");
      return;
    }
    const valorNum = parseValorMonetarioBr(irEditarValor);
    if (valorNum == null || valorNum < 0) {
      setIrEditarErro("Informe um valor válido (ex.: 1.234,56).");
      return;
    }

    setIrEditarSalvando(true);
    try {
      const { data, error } = await supabase
        .from("medico_ir_retido")
        .update({ valor_ir_retido: valorNum })
        .eq("cpf_apenas_numeros", irEditarCtx.doc)
        .eq("empresa", irEditarCtx.empresa)
        .eq("competencia", competencia)
        .select("id");
      if (error) {
        setIrEditarErro(error.message || "Erro ao atualizar.");
        return;
      }
      if (!data?.length) {
        setIrEditarErro("Registro não encontrado. Atualize a página.");
        return;
      }
      setIrEditarCtx(null);
      setMensagemView({ tipo: "ok", texto: "IR retido atualizado." });
      setTimeout(() => setMensagemView(null), 3000);
      const { map, rows } = await fetchIrRetidoCompleto();
      setIrRetidoPorCelula(map);
      setIrRetidoRegistros(rows);
    } finally {
      setIrEditarSalvando(false);
    }
  }

  async function fetchViewRows(): Promise<ViewRow[]> {
    const todos: ViewRow[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("view_concimed_pagamentos_realizados")
        .select("*")
        .order("razao_social")
        .order("ano", { ascending: true })
        .order("mes", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        console.error(error);
        break;
      }
      const chunk = (data as ViewRow[]) ?? [];
      todos.push(...chunk);
      if (chunk.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return todos;
  }

  async function fetchIrRetidoCompleto(): Promise<{
    map: Map<string, number>;
    rows: MedicoIrRetidoRegistro[];
  }> {
    const map = new Map<string, number>();
    const rows: MedicoIrRetidoRegistro[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase
        .from("medico_ir_retido")
        .select("nome_medico, cpf_apenas_numeros, empresa, competencia, valor_ir_retido")
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) {
        console.error(error);
        break;
      }
      const chunk =
        (data as {
          nome_medico: string;
          cpf_apenas_numeros: string;
          empresa: string;
          competencia: string;
          valor_ir_retido: number;
        }[]) ?? [];
      for (const row of chunk) {
        const km = competenciaParaKm(row.competencia);
        if (!km) continue;
        const doc = apenasNumeros(String(row.cpf_apenas_numeros ?? ""));
        const emp = String(row.empresa ?? "").trim();
        const key = chaveIrRetidoCelula(emp, doc, km);
        map.set(key, Number(row.valor_ir_retido) || 0);
        rows.push({
          nome_medico: String(row.nome_medico ?? "").trim() || "—",
          cpf_apenas_numeros: doc,
          empresa: emp,
          competencia: String(row.competencia ?? "").slice(0, 10),
          valor_ir_retido: Number(row.valor_ir_retido) || 0,
        });
      }
      if (chunk.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    return { map, rows };
  }

  async function carregarDados() {
    setLoading(true);
    try {
      const [todos, { map, rows }] = await Promise.all([fetchViewRows(), fetchIrRetidoCompleto()]);
      setRows(todos);
      setIrRetidoPorCelula(map);
      setIrRetidoRegistros(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    if (!irModalLinha) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !irSalvando) {
        setIrModalLinha(null);
        setIrErroModal(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [irModalLinha, irSalvando]);

  useEffect(() => {
    if (!irEditarCtx) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !irEditarSalvando) {
        setIrEditarCtx(null);
        setIrEditarErro(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [irEditarCtx, irEditarSalvando]);

  async function atualizarView() {
    setMensagemView(null);
    setAtualizandoView(true);
    try {
      const { error } = await supabase.rpc("refresh_view_concimed_pagamentos_realizados");
      if (error) throw error;
      setMensagemView({ tipo: "ok", texto: "View atualizada. Recarregando dados..." });
      await carregarDados();
      setMensagemView({ tipo: "ok", texto: "Dados atualizados." });
      setTimeout(() => setMensagemView(null), 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMensagemView({ tipo: "erro", texto: `Erro ao atualizar view: ${msg}` });
    } finally {
      setAtualizandoView(false);
    }
  }

  const { linhas, colunasMesAno, anosDisponiveis, razoesSociaisDisponiveis } = useMemo(() => {
    const rowsFiltradas =
      anosFiltro.length > 0 ? rows.filter((r) => anosFiltro.includes(String(r.ano))) : rows;

    const anosSet = new Set<number>();
    rows.forEach((r) => anosSet.add(r.ano));
    const razoesSet = new Set<string>();
    rowsFiltradas.forEach((r) => {
      const nome = (r.razao_social || "").trim();
      if (nome) razoesSet.add(nome);
    });

    const porCliente = new Map<string, AgregadoPagamentosCliente>();
    const setMesAno = new Set<string>();

    for (const r of rowsFiltradas) {
      const cnpjDigits = (r.cnpj_cpf_apenas_numeros || "").replace(/\D/g, "");
      const keyBase =
        cnpjDigits.length >= 11
          ? `cnpj_${cnpjDigits}`
          : r.chave_cliente ?? `_${(r.razao_social || "").trim()}_${r.cnpj_cpf_apenas_numeros}`;
      const key = `${r.empresa || ""}_${keyBase}`;
      if (!porCliente.has(key)) {
        porCliente.set(key, {
          empresa: r.empresa,
          chave_cliente: r.chave_cliente,
          razao_social: (r.razao_social || "").trim() || "—",
          cnpj_cpf_apenas_numeros: cnpjDigits.length >= 11 ? cnpjDigits : (r.cnpj_cpf_apenas_numeros || ""),
          porMesRepasse: new Map(),
          porMesRt: new Map(),
        });
      }
      const lin = porCliente.get(key)!;
      const vr = Number(r.valor_pago_corrigido) || 0;
      const vrt = Number(r.valor_responsavel_tecnico) || 0;
      const km = chaveMes(r.ano, r.mes);
      lin.porMesRepasse.set(km, (lin.porMesRepasse.get(km) ?? 0) + vr);
      lin.porMesRt.set(km, (lin.porMesRt.get(km) ?? 0) + vrt);
      if (!lin.razao_social || lin.razao_social === "—") {
        const nome = (r.razao_social || "").trim();
        if (nome) lin.razao_social = nome;
      }
      setMesAno.add(km);
    }

    // Colunas mês/ano em ordem crescente: mais antigo → mais novo
    const colunasMesAno = Array.from(setMesAno).sort((a, b) => {
      const [aAno, aMes] = a.split("_").map(Number);
      const [bAno, bMes] = b.split("_").map(Number);
      return aAno !== bAno ? aAno - bAno : aMes - bMes;
    });

    const anosDisponiveis = Array.from(anosSet).sort((a, b) => b - a);
    const razoesSociaisDisponiveis = Array.from(razoesSet).sort((a, b) => a.localeCompare(b, "pt-BR"));

    let linhasFiltradas = Array.from(porCliente.values()).flatMap(agregadoParaLinhasExibicao);
    if (razoesSociaisFiltro.length > 0) {
      const selecionadas = new Set(razoesSociaisFiltro);
      linhasFiltradas = linhasFiltradas.filter((l) => selecionadas.has(l.razao_social));
    }
    if (busca.trim()) {
      const termo = busca.trim().toLowerCase();
      const digitos = apenasNumeros(busca);
      linhasFiltradas = linhasFiltradas.filter((l) => {
        const bateNome = l.razao_social.toLowerCase().includes(termo);
        const bateCpf = digitos.length >= 11 && l.cnpj_cpf_apenas_numeros.includes(digitos);
        return bateNome || bateCpf;
      });
    }

    // Ordenação aplicada depois (por estado ordenarPor/ordemAsc)
    return { linhas: linhasFiltradas, colunasMesAno, anosDisponiveis, razoesSociaisDisponiveis };
  }, [rows, busca, anosFiltro, razoesSociaisFiltro]);

  const linhasOrdenadas = useMemo(() => {
    const ord = [...linhas];
    function desempateMesmoMedico(a: ClienteLinha, b: ClienteLinha): number {
      const e = (a.empresa || "").localeCompare(b.empresa || "", "pt-BR");
      if (e !== 0) return e;
      return ORDEM_TIPO_LINHA[a.tipoLinha] - ORDEM_TIPO_LINHA[b.tipoLinha];
    }
    if (ordenarPor === "razao_social") {
      ord.sort((a, b) => {
        const c = ordemAsc
          ? (a.razao_social || "").localeCompare(b.razao_social || "", "pt-BR")
          : (b.razao_social || "").localeCompare(a.razao_social || "", "pt-BR");
        if (c !== 0) return c;
        return desempateMesmoMedico(a, b);
      });
    } else if (ordenarPor === "cnpj_cpf") {
      ord.sort((a, b) => {
        const x = (a.cnpj_cpf_apenas_numeros || "").padStart(14, "0");
        const y = (b.cnpj_cpf_apenas_numeros || "").padStart(14, "0");
        const c = ordemAsc ? x.localeCompare(y) : y.localeCompare(x);
        if (c !== 0) return c;
        return desempateMesmoMedico(a, b);
      });
    } else if (ordenarPor.startsWith("mes:")) {
      const km = ordenarPor.slice(4);
      ord.sort((a, b) => {
        const va = Number(a.porMes.get(km)) || 0;
        const vb = Number(b.porMes.get(km)) || 0;
        if (va === vb) {
          if (a.valor_total !== b.valor_total) return b.valor_total - a.valor_total;
          const n = (a.razao_social || "").localeCompare(b.razao_social || "", "pt-BR");
          if (n !== 0) return n;
          return desempateMesmoMedico(a, b);
        }
        return ordemAsc ? va - vb : vb - va;
      });
    } else {
      ord.sort((a, b) => {
        const d = ordemAsc ? a.valor_total - b.valor_total : b.valor_total - a.valor_total;
        if (d !== 0) return d;
        const n = (a.razao_social || "").localeCompare(b.razao_social || "", "pt-BR");
        if (n !== 0) return n;
        return desempateMesmoMedico(a, b);
      });
    }
    return ord;
  }, [linhas, ordenarPor, ordemAsc]);

  /** Zebra por bloco (nome + CPF iguais): alterna fundo e marca início/fim de grupo com borda mais forte. */
  const zebraPorNomeCpf = useMemo(() => {
    const n = linhasOrdenadas.length;
    if (n === 0) return [];
    let blocoPar = false;
    let prevChave = chaveNomeCpfLinha(linhasOrdenadas[0]);
    return linhasOrdenadas.map((l, i) => {
      const chave = chaveNomeCpfLinha(l);
      if (i > 0 && chave !== prevChave) {
        blocoPar = !blocoPar;
        prevChave = chave;
      }
      const inicioGrupo = i === 0 || chaveNomeCpfLinha(linhasOrdenadas[i - 1]) !== chave;
      const fimGrupo = i === n - 1 || chaveNomeCpfLinha(linhasOrdenadas[i + 1]) !== chave;
      return { blocoPar, inicioGrupo, fimGrupo };
    });
  }, [linhasOrdenadas]);

  function toggleOrdenacao(col: OrdenarPor) {
    if (ordenarPor === col) {
      setOrdemAsc((a) => !a);
    } else {
      setOrdenarPor(col);
      setOrdemAsc(col === "total" ? false : true);
    }
  }

  function toggleOrdenacaoMes(km: string) {
    const col: OrdenarPor = `mes:${km}`;
    if (ordenarPor === col) {
      setOrdemAsc((a) => !a);
    } else {
      setOrdenarPor(col);
      // Para mês, default desc (maior valor primeiro)
      setOrdemAsc(false);
    }
  }

  const totais = useMemo(() => {
    const porMes = new Map<string, number>();
    let totalGeral = 0;
    linhasOrdenadas.forEach((l) => {
      if (l.tipoLinha === "total_combinado") return;
      totalGeral += l.valor_total;
      l.porMes.forEach((v, km) => porMes.set(km, (porMes.get(km) ?? 0) + v));
    });
    return { porMes, totalGeral };
  }, [linhasOrdenadas]);

  const contextoExportacao = useMemo(() => {
    const filtroIrExport = (r: MedicoIrRetidoRegistro) => {
      if (anosFiltro.length > 0) {
        const km = competenciaParaKm(r.competencia);
        if (!km) return false;
        const [yy] = km.split("_").map(Number);
        if (!anosFiltro.includes(String(yy))) return false;
      }
      if (busca.trim()) {
        const termo = busca.trim().toLowerCase();
        const digitos = apenasNumeros(busca);
        const bateNome = r.nome_medico.toLowerCase().includes(termo);
        const bateDoc = digitos.length >= 11 && r.cpf_apenas_numeros.includes(digitos);
        if (!bateNome && !bateDoc) return false;
      }
      if (razoesSociaisFiltro.length > 0) {
        const selecionadas = new Set(razoesSociaisFiltro);
        if (!selecionadas.has(r.nome_medico)) return false;
      }
      return true;
    };
    const irExport = irRetidoRegistros.filter(filtroIrExport);
    const kmSet = new Set<string>(colunasMesAno);
    irExport.forEach((r) => {
      const km = competenciaParaKm(r.competencia);
      if (km) kmSet.add(km);
    });
    const colunasExport = Array.from(kmSet).sort((a, b) => {
      const [aAno, aMes] = a.split("_").map(Number);
      const [bAno, bMes] = b.split("_").map(Number);
      return aAno !== bAno ? aAno - bAno : aMes - bMes;
    });
    return { irExport, colunasExport };
  }, [irRetidoRegistros, colunasMesAno, anosFiltro, busca, razoesSociaisFiltro]);

  function exportarExcel() {
    const { irExport, colunasExport } = contextoExportacao;

    const headers = [
      "Empresa",
      "Razão social",
      "CPF/CNPJ",
      "Tipo de pagamento",
      ...colunasExport.map((km) => {
        const [ano, mes] = km.split("_").map(Number);
        return labelMes(ano, mes);
      }),
    ];
    const data: (string | number)[][] = [headers];

    linhasOrdenadas.forEach((l) => {
      const row: (string | number)[] = [
        textoParaExcel(l.empresa),
        textoParaExcel(l.razao_social),
        textoParaExcel(l.cnpj_cpf_apenas_numeros),
        textoParaExcel(l.tipoLabel),
      ];
      colunasExport.forEach((km) => row.push(Number(l.porMes.get(km)) || 0));
      data.push(row);
    });

    irExport.forEach((r) => {
      const km = competenciaParaKm(r.competencia);
      const valor = Number(r.valor_ir_retido) || 0;
      const row: (string | number)[] = [
        textoParaExcel(r.empresa),
        textoParaExcel(r.nome_medico),
        textoParaExcel(r.cpf_apenas_numeros),
        "IR Retido",
      ];
      colunasExport.forEach((k) => row.push(k === km ? valor : 0));
      data.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    const colValorInicio = 4;
    const colValorFim = 4 + colunasExport.length - 1;
    for (let row = 1; row <= data.length - 1; row++) {
      for (let col = colValorInicio; col <= colValorFim; col++) {
        const ref = XLSX.utils.encode_cell({ r: row, c: col });
        if (ws[ref] && typeof ws[ref].v === "number") {
          ws[ref].z = FORMATO_NUMERO_BR;
        }
      }
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pagamentos realizados");
    XLSX.writeFile(wb, "pagamentos-realizados-concimed.xlsx");
  }

  async function gerarPdfRelatorio() {
    const { irExport, colunasExport } = contextoExportacao;
    if (colunasExport.length === 0) {
      window.alert("Não há colunas de mês/ano para montar o relatório. Verifique os filtros e os dados.");
      return;
    }

    const mesLabels = colunasExport.map((km) => {
      const [ano, mes] = km.split("_").map(Number);
      return labelMes(ano, mes);
    });

    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const margin = 10;
    let startY = 12;
    const gap = 5;
    const pageH = doc.internal.pageSize.getHeight();

    function ensureSpace(minBelowStartY: number) {
      if (startY + minBelowStartY > pageH - margin) {
        doc.addPage();
        startY = margin;
      }
    }

    const resumoAnosFiltroPdf =
      anosFiltro.length === 0
        ? "Todos os anos"
        : anosFiltro
            .slice()
            .sort((a, b) => Number(b) - Number(a))
            .join(", ");

    const logoPng = await carregarLogoConcimedPngDataUrl();
    if (logoPng) {
      const maxWmm = 42;
      const props = doc.getImageProperties(logoPng);
      const imgHmm = (props.height * maxWmm) / props.width;
      doc.addImage(logoPng, "PNG", margin, startY, maxWmm, imgHmm);
      startY += imgHmm + 5;
    }

    doc.setFontSize(14);
    doc.text("Pagamentos realizados — Concimed", margin, startY);
    startY += 7;
    doc.setFontSize(9);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")}`, margin, startY);
    startY += 5;
    doc.text(`Ano(s): ${resumoAnosFiltroPdf}`, margin, startY);
    startY += 4;
    if (busca.trim()) {
      doc.text(`Busca: ${busca.trim()}`, margin, startY);
      startY += 4;
    }
    startY += gap;

    function nomePorDoc(d: string): string {
      const linha = linhasOrdenadas.find(
        (l) => apenasNumeros(l.cnpj_cpf_apenas_numeros) === d && l.tipoLinha !== "total_combinado"
      );
      if (linha?.razao_social?.trim()) return linha.razao_social.trim();
      const ir = irExport.find((x) => apenasNumeros(x.cpf_apenas_numeros) === d);
      return (ir?.nome_medico || "").trim() || d;
    }

    const docKeys = new Set<string>();
    linhasOrdenadas.forEach((l) => {
      const d = apenasNumeros(l.cnpj_cpf_apenas_numeros);
      if (d) docKeys.add(d);
    });
    irExport.forEach((r) => {
      const d = apenasNumeros(r.cpf_apenas_numeros);
      if (d) docKeys.add(d);
    });

    const sortedDocs = Array.from(docKeys).sort((a, b) => {
      const na = nomePorDoc(a).toLowerCase();
      const nb = nomePorDoc(b).toLowerCase();
      if (na !== nb) return na.localeCompare(nb, "pt-BR");
      return a.localeCompare(b);
    });

    type DocWithLastTable = jsPDF & { lastAutoTable?: { finalY: number } };

    for (const d of sortedDocs) {
      const linhasDoc = linhasOrdenadas.filter((l) => apenasNumeros(l.cnpj_cpf_apenas_numeros) === d);
      const irDoc = irExport.filter((r) => apenasNumeros(r.cpf_apenas_numeros) === d);

      ensureSpace(28);
      doc.setFontSize(11);
      doc.text(nomePorDoc(d), margin, startY);
      startY += 5;
      doc.setFontSize(9);
      doc.text(`CPF/CNPJ: ${formatarCnpjCpf(d)}`, margin, startY);
      startY += 7;

      if (linhasDoc.length > 0) {
        doc.setFontSize(9);
        doc.text("Pagamentos por empresa e tipo", margin, startY);
        startY += 4;

        const linhasDocSemTotal = linhasDoc.filter((l) => l.tipoLinha !== "total_combinado");
        const colTotalsDiv = colunasExport.map((km) =>
          linhasDocSemTotal.reduce((s, l) => s + (Number(l.porMes.get(km)) || 0), 0)
        );
        const bodyDiv = linhasDoc.map((l) => {
          const cells = colunasExport.map((km) => moedaPdf(Number(l.porMes.get(km)) || 0));
          const rowTot = colunasExport.reduce((s, km) => s + (Number(l.porMes.get(km)) || 0), 0);
          return [textoParaExcel(l.empresa), textoParaExcel(l.tipoLabel), ...cells, moedaPdf(rowTot)];
        });
        const footDiv: string[] = [
          "Total",
          "",
          ...colTotalsDiv.map(moedaPdf),
          moedaPdf(colTotalsDiv.reduce((a, b) => a + b, 0)),
        ];

        autoTable(doc, {
          startY,
          head: [["Empresa", "Tipo", ...mesLabels, "Total"]],
          body: bodyDiv,
          foot: [footDiv],
          showFoot: "lastPage",
          theme: "grid",
          styles: { fontSize: 6, cellPadding: 0.8 },
          headStyles: { fillColor: PDF_HEAD_FILL, textColor: PDF_HEAD_FOOT_TEXT },
          footStyles: { fillColor: PDF_FOOT_FILL, textColor: PDF_HEAD_FOOT_TEXT },
          margin: { left: margin, right: margin },
        });
        startY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? startY) + gap;
      }

      if (irDoc.length > 0) {
        const porEmpresaIr = new Map<string, Map<string, number>>();
        irDoc.forEach((r) => {
          const km = competenciaParaKm(r.competencia);
          if (!km || !colunasExport.includes(km)) return;
          const em = (r.empresa || "").trim() || "—";
          if (!porEmpresaIr.has(em)) porEmpresaIr.set(em, new Map());
          const m = porEmpresaIr.get(em)!;
          m.set(km, (m.get(km) ?? 0) + (Number(r.valor_ir_retido) || 0));
        });

        if (porEmpresaIr.size > 0) {
          ensureSpace(22);
          doc.setFontSize(9);
          doc.text("IR retido (por empresa)", margin, startY);
          startY += 4;

          const bodyIr = Array.from(porEmpresaIr.entries()).map(([empresa, mesMap]) => {
            const cells = colunasExport.map((km) => moedaPdf(Number(mesMap.get(km)) || 0));
            const rowTot = colunasExport.reduce((s, km) => s + (Number(mesMap.get(km)) || 0), 0);
            return [textoParaExcel(empresa), ...cells, moedaPdf(rowTot)];
          });
          const colTotalsIr = colunasExport.map((km) =>
            Array.from(porEmpresaIr.values()).reduce((s, m) => s + (Number(m.get(km)) || 0), 0)
          );
          const footIr: string[] = [
            "Total",
            ...colTotalsIr.map(moedaPdf),
            moedaPdf(colTotalsIr.reduce((a, b) => a + b, 0)),
          ];

          autoTable(doc, {
            startY,
            head: [["Empresa", ...mesLabels, "Total"]],
            body: bodyIr,
            foot: [footIr],
            showFoot: "lastPage",
            theme: "grid",
            styles: { fontSize: 6, cellPadding: 0.8 },
            headStyles: { fillColor: PDF_HEAD_FILL, textColor: PDF_HEAD_FOOT_TEXT },
            footStyles: { fillColor: PDF_FOOT_FILL, textColor: PDF_HEAD_FOOT_TEXT },
            margin: { left: margin, right: margin },
          });
          startY = ((doc as DocWithLastTable).lastAutoTable?.finalY ?? startY) + gap;
        }
      }

      startY += 2;
    }

    ensureSpace(35);
    doc.setFontSize(11);
    doc.text("Totais por mês/ano e tipo de pagamento", margin, startY);
    startY += 6;

    const totaisDivPorKm = colunasExport.map((km) =>
      linhasOrdenadas
        .filter((l) => l.tipoLinha !== "total_combinado")
        .reduce((s, l) => s + (Number(l.porMes.get(km)) || 0), 0)
    );
    const totaisIrPorKm = colunasExport.map((km) => {
      let s = 0;
      irExport.forEach((r) => {
        if (competenciaParaKm(r.competencia) === km) s += Number(r.valor_ir_retido) || 0;
      });
      return s;
    });

    const summaryBody = colunasExport.map((km, i) => {
      const [ano, mes] = km.split("_").map(Number);
      return [
        labelMes(ano, mes),
        moedaPdf(totaisDivPorKm[i]),
        moedaPdf(totaisIrPorKm[i]),
        moedaPdf(totaisDivPorKm[i] + totaisIrPorKm[i]),
      ];
    });
    const sumDiv = totaisDivPorKm.reduce((a, b) => a + b, 0);
    const sumIr = totaisIrPorKm.reduce((a, b) => a + b, 0);

    autoTable(doc, {
      startY,
      head: [["Mês/ano", "Repasse + resp. técnico", "IR retido", "Total"]],
      body: summaryBody,
      foot: [["Total geral", moedaPdf(sumDiv), moedaPdf(sumIr), moedaPdf(sumDiv + sumIr)]],
      showFoot: "lastPage",
      theme: "grid",
      styles: { fontSize: 8, cellPadding: 1 },
      headStyles: { fillColor: PDF_HEAD_FILL, textColor: PDF_HEAD_FOOT_TEXT },
      footStyles: { fillColor: PDF_FOOT_FILL, textColor: PDF_HEAD_FOOT_TEXT },
      margin: { left: margin, right: margin },
    });

    doc.save("pagamentos-realizados-concimed.pdf");
  }

  function toggleAnoFiltro(anoStr: string) {
    setAnosFiltro((prev) => {
      if (prev.includes(anoStr)) return prev.filter((a) => a !== anoStr);
      return [...prev, anoStr].sort((a, b) => Number(b) - Number(a));
    });
  }

  function toggleRazaoSocialFiltro(razaoSocial: string) {
    setRazoesSociaisFiltro((prev) => {
      if (prev.includes(razaoSocial)) return prev.filter((r) => r !== razaoSocial);
      return [...prev, razaoSocial].sort((a, b) => a.localeCompare(b, "pt-BR"));
    });
  }

  const resumoAnosFiltro =
    anosFiltro.length === 0
      ? "Todos os anos"
      : anosFiltro
          .slice()
          .sort((a, b) => Number(b) - Number(a))
          .join(", ");

  const resumoRazoesSociaisFiltro =
    razoesSociaisFiltro.length === 0
      ? "Todas as razões sociais"
      : razoesSociaisFiltro.length === 1
        ? razoesSociaisFiltro[0]
        : `${razoesSociaisFiltro.length} selecionadas`;

  return (
    <div className="p-4 max-w-full">
      <h1 className="text-2xl font-bold text-slate-800">Pagamentos realizados</h1>
      <p className="text-slate-600 mt-1">
        Concimed — Repasse Ecografia / Repasse Médico e Responsabilidade Técnica (ou responsável técnico). Com os dois
        tipos no período, a grade mostra linhas separadas e uma linha Total. Busque por nome ou CPF/CNPJ (pode colar
        com pontuação).
      </p>

      <div className="mt-4 flex flex-wrap gap-4 items-center">
        <div className="flex items-start gap-2">
          <span className="text-slate-600 text-sm pt-2 shrink-0">Ano(s):</span>
          <details className="relative group border border-slate-300 rounded bg-white min-w-[200px]">
            <summary className="cursor-pointer list-none px-3 py-2 pr-8 text-sm text-slate-800 hover:bg-slate-50 rounded [&::-webkit-details-marker]:hidden">
              <span className="block truncate max-w-[240px]" title={resumoAnosFiltro}>
                {resumoAnosFiltro}
              </span>
            </summary>
            <div className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-64 overflow-y-auto rounded border border-slate-200 bg-white py-2 shadow-lg">
              <button
                type="button"
                onClick={() => setAnosFiltro([])}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Todos os anos
              </button>
              <div className="border-t border-slate-100 my-1" />
              {anosDisponiveis.map((a) => {
                const s = String(a);
                const marcado = anosFiltro.includes(s);
                return (
                  <label
                    key={s}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => toggleAnoFiltro(s)}
                      className="rounded border-slate-300"
                    />
                    <span>{s}</span>
                  </label>
                );
              })}
            </div>
          </details>
        </div>
        <div className="flex items-start gap-2">
          <span className="text-slate-600 text-sm pt-2 shrink-0">Razão social:</span>
          <details className="relative group border border-slate-300 rounded bg-white min-w-[280px]">
            <summary className="cursor-pointer list-none px-3 py-2 pr-8 text-sm text-slate-800 hover:bg-slate-50 rounded [&::-webkit-details-marker]:hidden">
              <span className="block truncate max-w-[320px]" title={resumoRazoesSociaisFiltro}>
                {resumoRazoesSociaisFiltro}
              </span>
            </summary>
            <div className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-64 overflow-y-auto rounded border border-slate-200 bg-white py-2 shadow-lg">
              <button
                type="button"
                onClick={() => setRazoesSociaisFiltro([])}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
              >
                Todas as razões sociais
              </button>
              <div className="border-t border-slate-100 my-1" />
              {razoesSociaisDisponiveis.map((razao) => {
                const marcado = razoesSociaisFiltro.includes(razao);
                return (
                  <label
                    key={razao}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      onChange={() => toggleRazaoSocialFiltro(razao)}
                      className="rounded border-slate-300"
                    />
                    <span className="truncate" title={razao}>
                      {razao}
                    </span>
                  </label>
                );
              })}
            </div>
          </details>
        </div>
        <input
          type="text"
          placeholder="Buscar por razão social ou CPF/CNPJ"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="border border-slate-300 rounded px-3 py-2 min-w-[280px]"
        />
        <button
          type="button"
          onClick={exportarExcel}
          disabled={linhasOrdenadas.length === 0 && contextoExportacao.irExport.length === 0}
          className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Exportar Excel
        </button>
        <button
          type="button"
          onClick={() => void gerarPdfRelatorio()}
          disabled={
            contextoExportacao.colunasExport.length === 0 ||
            (linhasOrdenadas.length === 0 && contextoExportacao.irExport.length === 0)
          }
          className="px-4 py-2 rounded bg-rose-700 text-white text-sm font-medium hover:bg-rose-800 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Gerar PDF
        </button>
        <button
          type="button"
          onClick={atualizarView}
          disabled={atualizandoView}
          className="px-4 py-2 rounded bg-slate-700 text-white text-sm hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {atualizandoView ? "Atualizando..." : "Atualizar dados da view"}
        </button>
        {mensagemView && (
          <span
            className={`text-sm ${mensagemView.tipo === "ok" ? "text-green-700" : "text-red-700"}`}
          >
            {mensagemView.texto}
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-4 text-slate-500">Carregando...</p>
      ) : (
        <div className="mt-4 overflow-auto border border-slate-200 rounded max-h-[calc(100vh-12rem)]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-30 bg-slate-100 shadow-[0_1px_0_0_rgba(0,0,0,0.1)] [isolation:isolate]">
              <tr className="text-left">
                <th className="p-2 border-b border-slate-200 bg-slate-100 min-w-[100px] whitespace-nowrap">
                  Empresa
                </th>
                <th
                  className="p-2 border-b border-slate-200 sticky left-0 z-40 bg-slate-100 min-w-[180px] cursor-pointer select-none hover:bg-slate-200 shadow-[4px_0_8px_-2px_rgba(15,23,42,0.12)]"
                  onClick={() => toggleOrdenacao("razao_social")}
                  title="Ordenar por razão social"
                >
                  Razão social
                  {ordenarPor === "razao_social" && (ordemAsc ? " ↑" : " ↓")}
                </th>
                <th
                  className="p-2 border-b border-slate-200 bg-slate-100 min-w-[120px] cursor-pointer select-none hover:bg-slate-200"
                  onClick={() => toggleOrdenacao("cnpj_cpf")}
                  title="Ordenar por CPF/CNPJ"
                >
                  CPF/CNPJ
                  {ordenarPor === "cnpj_cpf" && (ordemAsc ? " ↑" : " ↓")}
                </th>
                <th className="p-2 border-b border-slate-200 bg-slate-100 min-w-[140px] whitespace-nowrap">
                  Tipo
                </th>
                <th
                  className="p-2 border-b border-slate-200 bg-slate-100 w-14 text-center whitespace-nowrap"
                  title="Informar IR retido"
                >
                  IR
                </th>
                {colunasMesAno.map((km) => {
                  const [ano, mes] = km.split("_").map(Number);
                  const col: OrdenarPor = `mes:${km}`;
                  return (
                    <th
                      key={km}
                      className="p-2 border-b border-slate-200 bg-slate-100 whitespace-nowrap min-w-[80px] cursor-pointer select-none hover:bg-slate-200 text-right"
                      onClick={() => toggleOrdenacaoMes(km)}
                      title={`Ordenar por ${labelMes(ano, mes)}`}
                    >
                      {labelMes(ano, mes)}
                      {ordenarPor === col && (ordemAsc ? " ↑" : " ↓")}
                    </th>
                  );
                })}
                <th
                  className="p-2 border-b border-slate-200 bg-slate-100 min-w-[100px] cursor-pointer select-none hover:bg-slate-200 text-right"
                  onClick={() => toggleOrdenacao("total")}
                  title="Ordenar por total"
                >
                  Total
                  {ordenarPor === "total" && (ordemAsc ? " ↑" : " ↓")}
                </th>
              </tr>
            </thead>
            <tbody>
              {linhasOrdenadas.length === 0 ? (
                <tr>
                  <td colSpan={6 + colunasMesAno.length} className="p-4 text-slate-500 text-center">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                linhasOrdenadas.map((l, idx) => {
                  const meta = zebraPorNomeCpf[idx]!;
                  const isLinhaTotal = l.tipoLinha === "total_combinado";
                  const bgStripe = meta.blocoPar ? "bg-slate-50" : "bg-white";
                  const tdPadrao = isLinhaTotal
                    ? `${meta.blocoPar ? "bg-slate-100" : "bg-slate-50"} group-hover:bg-sky-100/90`
                    : `${bgStripe} group-hover:bg-sky-100`;
                  const trBorda = [
                    meta.inicioGrupo && idx > 0 ? "border-t-[3px] border-t-slate-500" : "",
                    meta.fimGrupo ? "border-b-[3px] border-b-slate-500" : "border-b border-slate-200",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                  <tr
                    key={`${l.empresa ?? ""}_${l.chave_cliente ?? l.cnpj_cpf_apenas_numeros}_${l.tipoLinha}_${idx}`}
                    className={`group transition-colors focus-within:bg-sky-100/80 ${trBorda} ${
                      isLinhaTotal ? "font-semibold" : ""
                    }`}
                  >
                    <td className={`p-2 whitespace-nowrap ${tdPadrao}`}>
                      {l.empresa || "—"}
                    </td>
                    <td className={`p-2 sticky left-0 z-20 min-w-[180px] font-medium shadow-[4px_0_8px_-2px_rgba(15,23,42,0.1)] ${tdPadrao}`}>
                      {l.razao_social || "—"}
                    </td>
                    <td className={`p-2 ${tdPadrao}`}>
                      {formatarCnpjCpf(l.cnpj_cpf_apenas_numeros)}
                    </td>
                    <td className={`p-2 whitespace-nowrap text-slate-700 ${tdPadrao}`}>
                      {l.tipoLabel}
                    </td>
                    <td className={`p-2 text-center align-middle ${tdPadrao}`}>
                      {l.tipoLinha === "repasse_medico" ? (
                        <button
                          type="button"
                          onClick={() => abrirModalIr(l)}
                          className="inline-flex items-center justify-center p-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                          title="Informar IR retido"
                          aria-label="Informar IR retido"
                        >
                          <IconeCaderneta className="w-5 h-5" />
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    {colunasMesAno.map((km) => {
                      const val = l.porMes.get(km);
                      const acima50k = Number(val) > 50000;
                      const docLinha = apenasNumeros(l.cnpj_cpf_apenas_numeros);
                      const chaveIr = chaveIrRetidoCelula(l.empresa, docLinha, km);
                      const irRetido = irRetidoPorCelula.get(chaveIr);
                      const temIr = irRetido != null && !Number.isNaN(irRetido);
                      return (
                        <td
                          key={km}
                          className={`p-2 text-right align-top ${tdPadrao} ${acima50k ? "text-red-600 font-semibold !bg-red-50 group-hover:!bg-red-50" : ""}`}
                        >
                          <div className="flex flex-col items-end gap-0.5 min-h-[2.5rem] justify-center">
                            <span className="whitespace-nowrap">{formatarMoeda(val)}</span>
                            {temIr && l.tipoLinha === "repasse_medico" && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  abrirEditarIr(l, km, irRetido);
                                }}
                                className="text-[10px] leading-tight text-amber-900/90 font-normal whitespace-nowrap underline decoration-dotted decoration-amber-700/60 underline-offset-2 hover:text-amber-950 hover:decoration-solid text-right max-w-full"
                                title="Clique para editar o IR retido"
                              >
                                IR retido {formatarMoedaIrRetido(irRetido)}
                              </button>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className={`p-2 text-right whitespace-nowrap font-medium ${tdPadrao}`}>
                      {formatarMoeda(l.valor_total)}
                    </td>
                  </tr>
                );
                })
              )}
            </tbody>
            {linhasOrdenadas.length > 0 && (
              <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={5} className="p-2 font-semibold text-slate-700">
                    Total
                  </td>
                  {colunasMesAno.map((km) => (
                    <td key={km} className="p-2 text-right whitespace-nowrap font-semibold">
                      {formatarMoeda(totais.porMes.get(km))}
                    </td>
                  ))}
                  <td className="p-2 text-right whitespace-nowrap font-semibold">
                    {formatarMoeda(totais.totalGeral)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {irModalLinha && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && fecharModalIr()}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full border border-slate-200"
            role="dialog"
            aria-labelledby="ir-modal-titulo"
            aria-modal="true"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 id="ir-modal-titulo" className="text-lg font-semibold text-slate-800">
                Informar IR retido
              </h2>
              <button
                type="button"
                onClick={fecharModalIr}
                disabled={irSalvando}
                className="text-slate-500 hover:text-slate-800 text-xl leading-none px-1 disabled:opacity-50"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">Nome</span>
                <p className="text-slate-900 font-medium">{irModalLinha.razao_social || "—"}</p>
              </div>
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">CPF/CNPJ</span>
                <p className="text-slate-900">{formatarCnpjCpf(irModalLinha.cnpj_cpf_apenas_numeros)}</p>
              </div>
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">Empresa</span>
                <p className="text-slate-900">{irModalLinha.empresa || "—"}</p>
              </div>
              <div>
                <label htmlFor="ir-competencia" className="block text-slate-700 font-medium mb-1">
                  Competência (mês da retenção)
                </label>
                <input
                  id="ir-competencia"
                  type="month"
                  value={irCompetencia}
                  onChange={(e) => setIrCompetencia(e.target.value)}
                  className="w-full border border-slate-300 rounded px-3 py-2"
                />
                <p className="text-slate-500 text-xs mt-1">
                  Será gravado como dia 01 do mês escolhido (01/mm/aaaa).
                </p>
              </div>
              <div>
                <label htmlFor="ir-valor" className="block text-slate-700 font-medium mb-1">
                  Valor do IR retido (R$)
                </label>
                <input
                  id="ir-valor"
                  type="text"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={irValor}
                  onChange={(e) => setIrValor(e.target.value)}
                  className="w-full border border-slate-300 rounded px-3 py-2"
                  autoComplete="off"
                />
              </div>
              {irErroModal && (
                <p className="text-red-600 text-sm" role="alert">
                  {irErroModal}
                </p>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={fecharModalIr}
                  disabled={irSalvando}
                  className="px-4 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvarIrRetido}
                  disabled={irSalvando}
                  className="px-4 py-2 rounded bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {irSalvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {irEditarCtx && (
        <div
          className="fixed inset-0 z-[101] flex items-center justify-center p-4 bg-black/40"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && fecharEditarIr()}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full border border-slate-200"
            role="dialog"
            aria-labelledby="ir-edit-titulo"
            aria-modal="true"
          >
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
              <h2 id="ir-edit-titulo" className="text-lg font-semibold text-slate-800">
                Editar IR retido
              </h2>
              <button
                type="button"
                onClick={fecharEditarIr}
                disabled={irEditarSalvando}
                className="text-slate-500 hover:text-slate-800 text-xl leading-none px-1 disabled:opacity-50"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">Nome</span>
                <p className="text-slate-900 font-medium">{irEditarCtx.razaoSocial}</p>
              </div>
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">CPF/CNPJ</span>
                <p className="text-slate-900">{formatarCnpjCpf(irEditarCtx.doc)}</p>
              </div>
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">Empresa</span>
                <p className="text-slate-900">{irEditarCtx.empresa || "—"}</p>
              </div>
              <div>
                <span className="text-slate-500 block text-xs uppercase tracking-wide">Competência</span>
                <p className="text-slate-900 font-medium">
                  {labelMes(
                    Number(irEditarCtx.km.split("_")[0]),
                    Number(irEditarCtx.km.split("_")[1])
                  )}
                </p>
              </div>
              <div>
                <label htmlFor="ir-edit-valor" className="block text-slate-700 font-medium mb-1">
                  Novo valor do IR retido (R$)
                </label>
                <input
                  id="ir-edit-valor"
                  type="text"
                  inputMode="decimal"
                  value={irEditarValor}
                  onChange={(e) => setIrEditarValor(e.target.value)}
                  className="w-full border border-slate-300 rounded px-3 py-2"
                  autoComplete="off"
                />
              </div>
              {irEditarErro && (
                <p className="text-red-600 text-sm" role="alert">
                  {irEditarErro}
                </p>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={fecharEditarIr}
                  disabled={irEditarSalvando}
                  className="px-4 py-2 rounded border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvarEdicaoIrRetido}
                  disabled={irEditarSalvando}
                  className="px-4 py-2 rounded bg-amber-600 text-white font-medium hover:bg-amber-700 disabled:opacity-50"
                >
                  {irEditarSalvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
