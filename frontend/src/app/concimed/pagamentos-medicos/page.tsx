"use client";

import { useEffect, useState, useMemo } from "react";
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
};

type ClienteLinha = {
  empresa: string;
  chave_cliente: string | null;
  razao_social: string;
  cnpj_cpf_apenas_numeros: string;
  valor_total: number;
  porMes: Map<string, number>;
};

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

const FORMATO_NUMERO_BR = "#.##0,00";
const ANO_TODOS = "";
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
  const [filtroAno, setFiltroAno] = useState<string>(ANO_TODOS);
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

  const { linhas, colunasMesAno, anosDisponiveis } = useMemo(() => {
    const rowsFiltradas =
      filtroAno !== ANO_TODOS
        ? rows.filter((r) => r.ano === parseInt(filtroAno, 10))
        : rows;

    const anosSet = new Set<number>();
    rows.forEach((r) => anosSet.add(r.ano));

    const porCliente = new Map<string, ClienteLinha>();
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
          valor_total: 0,
          porMes: new Map(),
        });
      }
      const lin = porCliente.get(key)!;
      const v = Number(r.valor_pago_corrigido) || 0;
      lin.valor_total += v;
      const km = chaveMes(r.ano, r.mes);
      lin.porMes.set(km, (lin.porMes.get(km) ?? 0) + v);
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

    let linhasFiltradas = Array.from(porCliente.values());
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
    return { linhas: linhasFiltradas, colunasMesAno, anosDisponiveis };
  }, [rows, busca, filtroAno]);

  const linhasOrdenadas = useMemo(() => {
    const ord = [...linhas];
    if (ordenarPor === "razao_social") {
      ord.sort((a, b) =>
        ordemAsc
          ? (a.razao_social || "").localeCompare(b.razao_social || "", "pt-BR")
          : (b.razao_social || "").localeCompare(a.razao_social || "", "pt-BR")
      );
    } else if (ordenarPor === "cnpj_cpf") {
      ord.sort((a, b) => {
        const x = (a.cnpj_cpf_apenas_numeros || "").padStart(14, "0");
        const y = (b.cnpj_cpf_apenas_numeros || "").padStart(14, "0");
        return ordemAsc ? x.localeCompare(y) : y.localeCompare(x);
      });
    } else if (ordenarPor.startsWith("mes:")) {
      const km = ordenarPor.slice(4);
      ord.sort((a, b) => {
        const va = Number(a.porMes.get(km)) || 0;
        const vb = Number(b.porMes.get(km)) || 0;
        if (va === vb) {
          // Desempate: total (desc) e depois nome
          if (a.valor_total !== b.valor_total) return b.valor_total - a.valor_total;
          return (a.razao_social || "").localeCompare(b.razao_social || "", "pt-BR");
        }
        return ordemAsc ? va - vb : vb - va;
      });
    } else {
      ord.sort((a, b) =>
        ordemAsc ? a.valor_total - b.valor_total : b.valor_total - a.valor_total
      );
    }
    return ord;
  }, [linhas, ordenarPor, ordemAsc]);

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
      totalGeral += l.valor_total;
      l.porMes.forEach((v, km) => porMes.set(km, (porMes.get(km) ?? 0) + v));
    });
    return { porMes, totalGeral };
  }, [linhasOrdenadas]);

  function exportarExcel() {
    const filtroIrExport = (r: MedicoIrRetidoRegistro) => {
      if (filtroAno !== ANO_TODOS) {
        const y = parseInt(filtroAno, 10);
        const km = competenciaParaKm(r.competencia);
        if (!km) return false;
        const [yy] = km.split("_").map(Number);
        if (yy !== y) return false;
      }
      if (busca.trim()) {
        const termo = busca.trim().toLowerCase();
        const digitos = apenasNumeros(busca);
        const bateNome = r.nome_medico.toLowerCase().includes(termo);
        const bateDoc = digitos.length >= 11 && r.cpf_apenas_numeros.includes(digitos);
        if (!bateNome && !bateDoc) return false;
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

    const headers = [
      "Empresa",
      "Razão social",
      "CPF/CNPJ",
      "IR",
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
        "",
        "Dividendos pagos",
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
        "",
        "IR Retido",
      ];
      colunasExport.forEach((k) => row.push(k === km ? valor : 0));
      data.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(data);
    const colValorInicio = 5;
    const colValorFim = 5 + colunasExport.length - 1;
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

  // Atualiza anos no select ao carregar (primeira vez); mantém "Todos" se já estava
  const opcoesAno = useMemo(() => {
    const list = [{ value: ANO_TODOS, label: "Todos os anos" }];
    anosDisponiveis.forEach((a) => list.push({ value: String(a), label: String(a) }));
    return list;
  }, [anosDisponiveis]);

  return (
    <div className="p-4 max-w-full">
      <h1 className="text-2xl font-bold text-slate-800">Pagamentos realizados</h1>
      <p className="text-slate-600 mt-1">
        Concimed — Repasse Ecografia e Repasse Médico. Busque por nome ou CPF/CNPJ (pode colar com pontuação).
      </p>

      <div className="mt-4 flex flex-wrap gap-4 items-center">
        <label className="flex items-center gap-2">
          <span className="text-slate-600 text-sm">Ano:</span>
          <select
            value={filtroAno}
            onChange={(e) => setFiltroAno(e.target.value)}
            className="border border-slate-300 rounded px-3 py-2"
          >
            {opcoesAno.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
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
          disabled={linhasOrdenadas.length === 0 && irRetidoRegistros.length === 0}
          className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Exportar Excel
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
                  <td colSpan={5 + colunasMesAno.length} className="p-4 text-slate-500 text-center">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                linhasOrdenadas.map((l, idx) => (
                  <tr
                    key={`${l.empresa ?? ""}_${l.chave_cliente ?? l.cnpj_cpf_apenas_numeros}_${idx}`}
                    className="group border-b border-slate-100 bg-white transition-colors hover:bg-sky-100 focus-within:bg-sky-100"
                  >
                    <td className="p-2 whitespace-nowrap bg-white group-hover:bg-sky-100">
                      {l.empresa || "—"}
                    </td>
                    <td className="p-2 sticky left-0 z-20 min-w-[180px] font-medium bg-white shadow-[4px_0_8px_-2px_rgba(15,23,42,0.1)] group-hover:bg-sky-100">
                      {l.razao_social || "—"}
                    </td>
                    <td className="p-2 bg-white group-hover:bg-sky-100">
                      {formatarCnpjCpf(l.cnpj_cpf_apenas_numeros)}
                    </td>
                    <td className="p-2 text-center bg-white group-hover:bg-sky-100 align-middle">
                      <button
                        type="button"
                        onClick={() => abrirModalIr(l)}
                        className="inline-flex items-center justify-center p-1.5 rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-amber-50 hover:border-amber-400 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                        title="Informar IR retido"
                        aria-label="Informar IR retido"
                      >
                        <IconeCaderneta className="w-5 h-5" />
                      </button>
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
                          className={`p-2 text-right align-top bg-white group-hover:bg-sky-100 ${acima50k ? "text-red-600 font-semibold !bg-red-50 group-hover:!bg-red-50" : ""}`}
                        >
                          <div className="flex flex-col items-end gap-0.5 min-h-[2.5rem] justify-center">
                            <span className="whitespace-nowrap">{formatarMoeda(val)}</span>
                            {temIr && (
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
                    <td className="p-2 text-right whitespace-nowrap font-medium bg-white group-hover:bg-sky-100">
                      {formatarMoeda(l.valor_total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {linhasOrdenadas.length > 0 && (
              <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={4} className="p-2 font-semibold text-slate-700">
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
