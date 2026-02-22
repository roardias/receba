"use client";

import { useEffect, useState, useMemo } from "react";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type ViewRow = {
  empresa_pagamento: string;
  empresa_razao_social: string | null;
  empresa_cnpj: string | null;
  cpf: string;
  nome: string;
  ano: number;
  mes: number;
  valor_pago: number;
  total_pago_mes: number;
  saldo_ata_inicial: number;
  competencia_mes: number;
  baixa_ata_mes: number;
  saldo_ata_final: number;
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

function formatarCpf(apenasNumeros: string | null | undefined): string {
  if (!apenasNumeros || !String(apenasNumeros).trim()) return "—";
  const n = String(apenasNumeros).replace(/\D/g, "");
  if (n.length <= 11) {
    return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  }
  return n;
}

function formatarCnpj(apenasNumeros: string | null | undefined): string {
  if (!apenasNumeros || !String(apenasNumeros).trim()) return "—";
  const n = String(apenasNumeros).replace(/\D/g, "").slice(0, 14).padStart(14, "0");
  if (n.length >= 14) {
    return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  }
  return n;
}

/** Aceita CPF com ponto e traço; retorna só dígitos para busca. */
function apenasNumeros(termo: string): string {
  return String(termo || "").replace(/\D/g, "");
}

function labelMes(ano: number, mes: number): string {
  return `${MESES_LABEL[mes - 1]}/${ano}`;
}

/** Remove caracteres de controle e normaliza Unicode (NFC) para evitar problema com acentos no Excel. */
function textoParaExcel(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .normalize("NFC")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .trim();
}

const FORMATO_NUMERO_BR = "#.##0,00";
const PAGE_SIZE = 1000;

export default function ControleDividendosAtaPage() {
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");

  async function carregarDados() {
    setLoading(true);
    const todos: ViewRow[] = [];
    let offset = 0;
    try {
      while (true) {
        const { data, error } = await supabase
          .from("view_controle_dividendos_ata_2025")
          .select("*")
          .order("nome")
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
      setRows(todos);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

  const rowsFiltradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = apenasNumeros(busca);
    if (!termo && !digitos) return rows;
    return rows.filter((r) => {
      const bateNome = termo && (r.nome || "").toLowerCase().includes(termo);
      const cpfLinha = String(r.cpf ?? "").replace(/\D/g, "").padStart(11, "0").slice(-11);
      const bateCpf = digitos.length > 0 && cpfLinha.includes(digitos);
      return bateNome || bateCpf;
    });
  }, [rows, busca]);

  function exportarExcel() {
    const headers = [
      "Empresa pagamento",
      "CPF",
      "Nome",
      "Ano",
      "Mês",
      "Saldo inicial",
      "Dividendos distribuídos",
      "Baixa Competência",
      "Baixa Ata 2025",
      "Saldo final",
    ];
    const data: (string | number)[][] = [headers];
    rowsFiltradas.forEach((r) => {
      data.push([
        textoParaExcel(r.empresa_pagamento),
        textoParaExcel(r.cpf),
        textoParaExcel(r.nome),
        r.ano,
        r.mes,
        Number(r.saldo_ata_inicial) || 0,
        Number(r.valor_pago) || 0,
        Number(r.competencia_mes) || 0,
        Number(r.baixa_ata_mes) || 0,
        Number(r.saldo_ata_final) || 0,
      ]);
    });
    if (rowsFiltradas.length > 0) {
      data.push([
        "Total",
        "",
        "",
        "",
        "",
        totais.saldoInicial,
        totais.dividendos,
        totais.baixaCompetencia,
        totais.baixaAta,
        totais.saldoFinal,
      ]);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    const colValorInicio = 5;
    const colValorFim = 9;
    for (let row = 1; row <= data.length - 1; row++) {
      for (let col = colValorInicio; col <= colValorFim; col++) {
        const ref = XLSX.utils.encode_cell({ r: row, c: col });
        if (ws[ref] && typeof ws[ref].v === "number") {
          ws[ref].z = FORMATO_NUMERO_BR;
        }
      }
    }
    ws["!cols"] = [
      { wch: 18 },
      { wch: 14 },
      { wch: 28 },
      { wch: 6 },
      { wch: 6 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Controle ATA 2025");
    XLSX.writeFile(wb, "controle-dividendos-ata-2025.xlsx");
  }

  function gerarPdf() {
    if (rowsFiltradas.length === 0) return;
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const headers = [
      "Empresa",
      "CPF",
      "Nome",
      "Ano",
      "Mês",
      "Saldo inicial",
      "Dividendos distr.",
      "Baixa Competência",
      "Baixa Ata 2025",
      "Saldo final",
    ];
    const porMedico = new Map<string, ViewRow[]>();
    rowsFiltradas.forEach((r) => {
      const key = `${r.nome ?? ""}_${r.cpf ?? ""}`;
      if (!porMedico.has(key)) porMedico.set(key, []);
      porMedico.get(key)!.push(r);
    });
    const medicosOrdenados = Array.from(porMedico.entries()).sort((a, b) =>
      (a[1][0]?.nome ?? "").localeCompare(b[1][0]?.nome ?? "", "pt-BR")
    );
    let startY = 15;
    const margin = 10;
    const pageH = doc.internal.pageSize.getHeight();
    // Altura aproximada: título (nome + CPF + empresa) ~22mm, cabeçalho tabela ~6mm, cada linha ~5mm, margem entre blocos 10mm
    const headerBlockMm = 22;
    const tableHeaderMm = 6;
    const rowMm = 5;
    const gapBetweenBlocks = 10;

    medicosOrdenados.forEach(([_, linhas]) => {
      const ordenadas = [...linhas].sort((a, b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes));
      const nomeMedico = ordenadas[0]?.nome ?? "—";
      const cpfMedico = ordenadas[0] ? formatarCpf(ordenadas[0].cpf) : "—";
      const nomeCurto = ordenadas[0]?.empresa_pagamento ?? "—";
      const razaoSocial = (ordenadas[0]?.empresa_razao_social ?? "").trim() || "—";
      const cnpjEmpresa = ordenadas[0]?.empresa_cnpj != null ? formatarCnpj(ordenadas[0].empresa_cnpj) : "—";

      const blockHeight = headerBlockMm + tableHeaderMm + ordenadas.length * rowMm + gapBetweenBlocks;
      if (startY + blockHeight > pageH - margin) {
        doc.addPage("a4", "landscape");
        startY = 15;
      }

      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text(nomeMedico, margin, startY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`CPF: ${cpfMedico}`, margin, startY + 5);
      doc.text(`Empresa (nome curto): ${nomeCurto}  |  Razão social: ${razaoSocial}  |  CNPJ: ${cnpjEmpresa}`, margin, startY + 10);
      startY += headerBlockMm;

      const body = ordenadas.map((r) => [
        r.empresa_pagamento || "—",
        formatarCpf(r.cpf),
        r.nome || "—",
        String(r.ano),
        labelMes(r.ano, r.mes),
        formatarMoeda(r.saldo_ata_inicial),
        formatarMoeda(r.valor_pago),
        formatarMoeda(r.competencia_mes),
        formatarMoeda(r.baixa_ata_mes),
        formatarMoeda(r.saldo_ata_final),
      ]);

      autoTable(doc, {
        head: [headers],
        body,
        startY,
        theme: "grid",
        styles: { fontSize: 7 },
        headStyles: { fillColor: [148, 163, 184] },
        margin: { left: margin, right: margin },
        rowPageBreak: "avoid",
      });
      startY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + gapBetweenBlocks;
    });

    doc.save("controle-dividendos-ata-2025.pdf");
  }

  const totais = useMemo(() => {
    let dividendos = 0;
    let baixaCompetencia = 0;
    let baixaAta = 0;
    rowsFiltradas.forEach((r) => {
      dividendos += Number(r.valor_pago) || 0;
      baixaCompetencia += Number(r.competencia_mes) || 0;
      baixaAta += Number(r.baixa_ata_mes) || 0;
    });
    // Saldo inicial total = soma do saldo inicial apenas do primeiro mês de cada médico
    const porMedico = new Map<string, ViewRow[]>();
    rowsFiltradas.forEach((r) => {
      const key = r.cpf ?? r.nome ?? "";
      if (!porMedico.has(key)) porMedico.set(key, []);
      porMedico.get(key)!.push(r);
    });
    let saldoInicial = 0;
    let saldoFinal = 0;
    porMedico.forEach((linhas) => {
      const ordenadas = [...linhas].sort((a, b) => a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes);
      const primeiroMes = ordenadas[0];
      const ultimoMes = ordenadas[ordenadas.length - 1];
      if (primeiroMes) saldoInicial += Number(primeiroMes.saldo_ata_inicial) || 0;
      if (ultimoMes) saldoFinal += Number(ultimoMes.saldo_ata_final) || 0;
    });
    return { saldoInicial, dividendos, baixaCompetencia, baixaAta, saldoFinal };
  }, [rowsFiltradas]);

  return (
    <div className="p-4 max-w-full">
      <h1 className="text-2xl font-bold text-slate-800">Controle dividendos ATA 2025</h1>
      <p className="text-slate-600 mt-1">
        Pagamentos por empresa vs. saldo ATA 2025 (Iris). Busque por nome do médico ou CPF (pode usar ponto e traço).
      </p>

      <div className="mt-4 flex flex-wrap gap-4 items-center">
        <input
          type="text"
          placeholder="Buscar por nome ou CPF"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="border border-slate-300 rounded px-3 py-2 min-w-[280px]"
        />
        <button
          type="button"
          onClick={exportarExcel}
          disabled={rowsFiltradas.length === 0}
          className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Exportar Excel
        </button>
        <button
          type="button"
          onClick={gerarPdf}
          disabled={rowsFiltradas.length === 0}
          className="px-4 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Gerar PDF
        </button>
      </div>

      {loading ? (
        <p className="mt-4 text-slate-500">Carregando...</p>
      ) : (
        <div className="mt-4 overflow-auto border border-slate-200 rounded max-h-[calc(100vh-12rem)]">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-100 shadow-[0_1px_0_0_rgba(0,0,0,0.1)]">
              <tr className="text-left">
                <th className="p-2 border-b border-slate-200 whitespace-nowrap bg-slate-100">Empresa pagamento</th>
                <th className="p-2 border-b border-slate-200 whitespace-nowrap bg-slate-100">CPF</th>
                <th className="p-2 border-b border-slate-200 whitespace-nowrap min-w-[160px] bg-slate-100">Nome</th>
                <th className="p-2 border-b border-slate-200 whitespace-nowrap bg-slate-100">Ano</th>
                <th className="p-2 border-b border-slate-200 whitespace-nowrap bg-slate-100">Mês</th>
                <th className="p-2 border-b border-slate-200 text-right whitespace-nowrap bg-slate-100">Saldo inicial</th>
                <th className="p-2 border-b border-slate-200 text-right whitespace-nowrap bg-slate-100">Dividendos distribuídos</th>
                <th className="p-2 border-b border-slate-200 text-right whitespace-nowrap bg-slate-100">Baixa Competência</th>
                <th className="p-2 border-b border-slate-200 text-right whitespace-nowrap bg-slate-100">Baixa Ata 2025</th>
                <th className="p-2 border-b border-slate-200 text-right whitespace-nowrap bg-slate-100">Saldo final</th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.length === 0 ? (
                <tr className="hover:bg-transparent">
                  <td colSpan={10} className="p-4 text-slate-500 text-center whitespace-nowrap">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                rowsFiltradas.map((r, idx) => (
                  <tr
                    key={`${r.cpf}-${r.empresa_pagamento}-${r.ano}-${r.mes}-${idx}`}
                    className="hover:bg-slate-200 transition-colors"
                  >
                    <td className="p-2 whitespace-nowrap">{r.empresa_pagamento || "—"}</td>
                    <td className="p-2 whitespace-nowrap">{formatarCpf(r.cpf)}</td>
                    <td className="p-2 font-medium whitespace-nowrap">{r.nome || "—"}</td>
                    <td className="p-2 whitespace-nowrap">{r.ano}</td>
                    <td className="p-2 whitespace-nowrap">{labelMes(r.ano, r.mes)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatarMoeda(r.saldo_ata_inicial)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatarMoeda(r.valor_pago)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatarMoeda(r.competencia_mes)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatarMoeda(r.baixa_ata_mes)}</td>
                    <td className="p-2 text-right whitespace-nowrap font-medium">{formatarMoeda(r.saldo_ata_final)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rowsFiltradas.length > 0 && (
              <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={5} className="p-2 whitespace-nowrap font-semibold text-slate-700">
                    Total
                  </td>
                  <td className="p-2 text-right whitespace-nowrap font-semibold">{formatarMoeda(totais.saldoInicial)}</td>
                  <td className="p-2 text-right whitespace-nowrap font-semibold">{formatarMoeda(totais.dividendos)}</td>
                  <td className="p-2 text-right whitespace-nowrap font-semibold">{formatarMoeda(totais.baixaCompetencia)}</td>
                  <td className="p-2 text-right whitespace-nowrap font-semibold">{formatarMoeda(totais.baixaAta)}</td>
                  <td className="p-2 text-right whitespace-nowrap font-semibold">{formatarMoeda(totais.saldoFinal)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
