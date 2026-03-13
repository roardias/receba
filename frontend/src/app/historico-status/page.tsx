"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** Fallback quando a tabela status_cobranca ainda não foi carregada. */
const FALLBACK_STATUS_LABELS: Record<string, string> = {
  em_cobranca: "Em cobrança",
  negociado_pagamento: "Negociado pagamento",
  nao_cumpriu_promessa_pagamento: "Não cumpriu promessa de pagamento",
  bloqueado: "Bloqueado",
  protestado: "Protestado",
  em_acao_judicial: "Em ação judicial",
  suspenso_temporariamente: "Suspenso Temporariamente",
};

type LogRow = {
  id: string;
  chave_cliente: string;
  status_anterior: string | null;
  status_novo: string;
  data_negociado_anterior: string | null;
  data_negociado_novo: string | null;
  created_at: string;
  updated_by: string | null;
};

type LogEnriquecido = LogRow & {
  nome_cliente: string;
  grupo: string;
  cnpj_cpf_apenas_numeros: string;
};

function apenasNumeros(s: string): string {
  return String(s ?? "").replace(/\D/g, "");
}

function formatarData(val: string | null) {
  if (!val) return "—";
  return new Date(val).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function HistoricoStatusPage() {
  const { hasPermissao } = useAuth();
  const podeAcessar = hasPermissao("menu_historico_cobrancas");

  const [enriquecidos, setEnriquecidos] = useState<LogEnriquecido[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [busca, setBusca] = useState("");
  /** Labels dos status (tabela status_cobranca). */
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>(FALLBACK_STATUS_LABELS);

  const labelStatus = (s: string | null): string => {
    if (!s) return "—";
    return statusLabels[s] ?? s;
  };

  useEffect(() => {
    supabase
      .from("status_cobranca")
      .select("codigo, label")
      .then(({ data }) => {
        if (data?.length) {
          const map: Record<string, string> = {};
          data.forEach((r: { codigo: string; label: string }) => {
            map[r.codigo] = r.label;
          });
          setStatusLabels(map);
        }
      });
  }, []);

  useEffect(() => {
    if (!podeAcessar) {
      setLoading(false);
      return;
    }
    let q = supabase
      .from("cliente_status_log")
      .select("id, chave_cliente, status_anterior, status_novo, data_negociado_anterior, data_negociado_novo, created_at, updated_by")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (dataInicio) q = q.gte("created_at", dataInicio + "T00:00:00");
    if (dataFim) q = q.lte("created_at", dataFim + "T23:59:59.999");
    setLoading(true);
    q.then(async ({ data: logData, error }) => {
      if (error) {
        console.error(error);
        setEnriquecidos([]);
        setLoading(false);
        return;
      }
      const logs = (logData as LogRow[]) ?? [];
      const chaves = Array.from(new Set(logs.map((r) => r.chave_cliente).filter(Boolean)));
      if (chaves.length === 0) {
        setEnriquecidos(logs.map((r) => ({ ...r, nome_cliente: "—", grupo: "—", cnpj_cpf_apenas_numeros: "" })));
        setLoading(false);
        return;
      }
      const { data: clientes } = await supabase
        .from("clientes")
        .select("chave_unica, nome_fantasia, razao_social, cnpj_cpf, acessoria_id")
        .in("chave_unica", chaves);
      const mapaCliente = new Map(
        (clientes ?? []).map((c: { chave_unica: string; nome_fantasia: string | null; razao_social: string | null; cnpj_cpf: string | null; acessoria_id: string | null }) => [
          c.chave_unica,
          {
            nome: (c.nome_fantasia || c.razao_social || "").trim() || "—",
            cnpjDigits: apenasNumeros(c.cnpj_cpf ?? ""),
            acessoria_id: c.acessoria_id,
          },
        ])
      );
      const acessoriaIds = Array.from(new Set((clientes ?? []).map((c: { acessoria_id: string | null }) => c.acessoria_id).filter(Boolean))) as string[];
      const mapaGrupo = new Map<string, string>();
      if (acessoriaIds.length > 0) {
        const { data: acessorias } = await supabase.from("acessorias").select("id, grupo_empresas").in("id", acessoriaIds);
        (acessorias ?? []).forEach((a: { id: string; grupo_empresas: string }) => {
          mapaGrupo.set(a.id, (a.grupo_empresas || "").trim() || "—");
        });
      }
      const lista: LogEnriquecido[] = logs.map((r) => {
        const cli = mapaCliente.get(r.chave_cliente);
        const grupo = cli?.acessoria_id ? mapaGrupo.get(cli.acessoria_id) ?? "—" : "—";
        return {
          ...r,
          nome_cliente: cli?.nome ?? "—",
          grupo,
          cnpj_cpf_apenas_numeros: cli?.cnpjDigits ?? "",
        };
      });
      setEnriquecidos(lista);
      setLoading(false);
    });
  }, [podeAcessar, dataInicio, dataFim]);

  const buscaNorm = busca.trim().toLowerCase();
  const buscaDigitos = apenasNumeros(busca);
  const rowsFiltrados = useMemo(() => {
    if (!buscaNorm && buscaDigitos.length < 6) return enriquecidos;
    return enriquecidos.filter((r) => {
      const nome = (r.nome_cliente ?? "").toLowerCase();
      const grupo = (r.grupo ?? "").toLowerCase();
      if (buscaDigitos.length >= 6 && r.cnpj_cpf_apenas_numeros && r.cnpj_cpf_apenas_numeros.includes(buscaDigitos)) return true;
      if (buscaNorm && (nome.includes(buscaNorm) || grupo.includes(buscaNorm))) return true;
      return false;
    });
  }, [enriquecidos, buscaNorm, buscaDigitos]);

  function exportarCsv() {
    const header = ["Nome cliente", "Grupo", "Data alteração", "Status"];
    const linhas = rowsFiltrados.map((r) => [
      r.nome_cliente,
      r.grupo,
      formatarData(r.created_at),
      labelStatus(r.status_novo),
    ]);
    const conteudo = [header, ...linhas]
      .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
      .join("\r\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + conteudo], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `historico_status_${dataInicio || "tudo"}${dataFim ? "_a_" + dataFim : ""}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function exportarPdf() {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const margin = 10;
    doc.setFontSize(14);
    doc.text("Histórico de alterações de status", margin, 12);
    doc.setFontSize(9);
    doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")} — ${rowsFiltrados.length} registro(s)`, margin, 18);
    autoTable(doc, {
      startY: 22,
      head: [["Nome cliente", "Grupo", "Data alteração", "Status"]],
      body: rowsFiltrados.map((r) => [
        (r.nome_cliente || "—").slice(0, 50),
        (r.grupo || "—").slice(0, 30),
        formatarData(r.created_at),
        labelStatus(r.status_novo),
      ]),
      theme: "grid",
      styles: { fontSize: 8 },
      headStyles: { fillColor: [71, 85, 105] },
      margin: { left: margin, right: margin },
      columnStyles: { 0: { cellWidth: 70 }, 1: { cellWidth: 45 }, 2: { cellWidth: 35 }, 3: { cellWidth: 50 } },
    });
    doc.save(`historico_status_${dataInicio || "tudo"}${dataFim ? "_a_" + dataFim : ""}.pdf`);
  }

  if (!podeAcessar) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Histórico de status</h1>
        <p className="text-slate-600 mt-1">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-full">
      <h1 className="text-2xl font-bold text-slate-800">Histórico de status</h1>
      <p className="text-slate-600 mt-1">
        Alterações de status de cobrança por cliente. Filtre por data, CNPJ/CPF (com ou sem pontuação) ou por nome e grupo. Ordenado pela data da alteração (mais recente primeiro).
      </p>

      <div className="mt-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Data início</label>
          <input
            type="date"
            value={dataInicio}
            onChange={(e) => setDataInicio(e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Data fim</label>
          <input
            type="date"
            value={dataFim}
            onChange={(e) => setDataFim(e.target.value)}
            className="px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Buscar por CNPJ/CPF ou nome</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Números do documento ou nome do cliente / grupo"
            className="px-3 py-2 border rounded min-w-[280px]"
          />
        </div>
        <button
          type="button"
          onClick={exportarCsv}
          disabled={rowsFiltrados.length === 0}
          className="px-4 py-2 rounded bg-slate-700 text-white text-sm hover:bg-slate-600 disabled:opacity-50"
        >
          Exportar CSV
        </button>
        <button
          type="button"
          onClick={exportarPdf}
          disabled={rowsFiltrados.length === 0}
          className="px-4 py-2 rounded bg-red-700 text-white text-sm hover:bg-red-600 disabled:opacity-50"
        >
          Relatório PDF
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-1">Pode usar CNPJ/CPF com ou sem pontos, vírgulas e barras. Busca também por nome e grupo.</p>

      <div className="mt-4 overflow-x-auto border rounded">
        {loading ? (
          <p className="p-4 text-slate-600">Carregando...</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left p-2">Nome cliente</th>
                <th className="text-left p-2">Grupo</th>
                <th className="text-left p-2">Data alteração status</th>
                <th className="text-left p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rowsFiltrados.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2 max-w-[280px] truncate" title={r.nome_cliente}>{r.nome_cliente}</td>
                  <td className="p-2">{r.grupo}</td>
                  <td className="p-2 whitespace-nowrap">{formatarData(r.created_at)}</td>
                  <td className="p-2 font-medium">{labelStatus(r.status_novo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && rowsFiltrados.length === 0 && (
          <p className="p-4 text-slate-500">Nenhum registro no período ou para o filtro informado.</p>
        )}
      </div>
    </div>
  );
}
