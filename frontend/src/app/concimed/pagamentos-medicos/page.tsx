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
type OrdenarPor = "razao_social" | "cnpj_cpf" | "total";

export default function PagamentosMedicosPage() {
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState("");
  const [filtroAno, setFiltroAno] = useState<string>(ANO_TODOS);
  const [ordenarPor, setOrdenarPor] = useState<OrdenarPor>("razao_social");
  const [ordemAsc, setOrdemAsc] = useState(true);
  const [atualizandoView, setAtualizandoView] = useState(false);
  const [mensagemView, setMensagemView] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const PAGE_SIZE = 1000; // Supabase retorna no máximo 1000 por consulta; buscar em páginas para trazer todos

  async function carregarDados() {
    setLoading(true);
    const todos: ViewRow[] = [];
    let offset = 0;
    try {
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
      setRows(todos);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    carregarDados();
  }, []);

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
    const headers = ["Empresa", "Razão social", "CPF/CNPJ", ...colunasMesAno.map((km) => {
      const [ano, mes] = km.split("_").map(Number);
      return labelMes(ano, mes);
    }), "Total"];
    const data: (string | number)[][] = [headers];
    linhasOrdenadas.forEach((l) => {
      const row: (string | number)[] = [
        textoParaExcel(l.empresa),
        textoParaExcel(l.razao_social),
        textoParaExcel(l.cnpj_cpf_apenas_numeros),
      ];
      colunasMesAno.forEach((km) => row.push(Number(l.porMes.get(km)) || 0));
      row.push(Number(l.valor_total) || 0);
      data.push(row);
    });
    if (linhasOrdenadas.length > 0) {
      const totalRow: (string | number)[] = ["Total", "", ""];
      colunasMesAno.forEach((km) => totalRow.push(totais.porMes.get(km) ?? 0));
      totalRow.push(totais.totalGeral);
      data.push(totalRow);
    }
    const ws = XLSX.utils.aoa_to_sheet(data);
    const colValorInicio = 3;
    const colValorFim = 3 + colunasMesAno.length;
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
          disabled={linhasOrdenadas.length === 0}
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
            <thead className="sticky top-0 z-20 bg-slate-100 shadow-[0_1px_0_0_rgba(0,0,0,0.1)] [isolation:isolate]">
              <tr className="text-left">
                <th className="p-2 border-b border-slate-200 bg-slate-100 min-w-[100px] whitespace-nowrap">
                  Empresa
                </th>
                <th
                  className="p-2 border-b border-slate-200 sticky left-0 bg-slate-100 z-20 min-w-[180px] cursor-pointer select-none hover:bg-slate-200"
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
                {colunasMesAno.map((km) => {
                  const [ano, mes] = km.split("_").map(Number);
                  return (
                    <th key={km} className="p-2 border-b border-slate-200 bg-slate-100 whitespace-nowrap min-w-[80px]">
                      {labelMes(ano, mes)}
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
                  <td colSpan={4 + colunasMesAno.length} className="p-4 text-slate-500 text-center">
                    Nenhum registro encontrado.
                  </td>
                </tr>
              ) : (
                linhasOrdenadas.map((l, idx) => (
                  <tr
                    key={`${l.empresa ?? ""}_${l.chave_cliente ?? l.cnpj_cpf_apenas_numeros}_${idx}`}
                    className="border-b border-slate-100 transition-colors hover:bg-sky-100 focus-within:bg-sky-100"
                  >
                    <td className="p-2 whitespace-nowrap">{l.empresa || "—"}</td>
                    <td className="p-2 sticky left-0 bg-inherit z-10 font-medium">{l.razao_social || "—"}</td>
                    <td className="p-2">{formatarCnpjCpf(l.cnpj_cpf_apenas_numeros)}</td>
                    {colunasMesAno.map((km) => {
                      const val = l.porMes.get(km);
                      const acima50k = Number(val) > 50000;
                      return (
                        <td
                          key={km}
                          className={`p-2 text-right whitespace-nowrap ${acima50k ? "text-red-600 font-semibold bg-red-50" : ""}`}
                        >
                          {formatarMoeda(val)}
                        </td>
                      );
                    })}
                    <td className="p-2 text-right whitespace-nowrap font-medium">
                      {formatarMoeda(l.valor_total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {linhasOrdenadas.length > 0 && (
              <tfoot className="sticky bottom-0 bg-slate-100 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={3} className="p-2 font-semibold text-slate-700">
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
    </div>
  );
}
