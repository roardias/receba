"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const API_TIPO_LABEL: Record<string, string> = {
  clientes: "Cadastro (clientes)",
  categorias: "Categorias",
  movimento_financeiro: "Movimento Financeiro",
  pagamentos_realizados: "Pagamentos Realizados",
  recebimentos_omie: "Recebimentos Omie",
};

type Log = {
  id: string;
  empresa_nome: string;
  api_tipo: string;
  iniciado_em: string;
  finalizado_em: string;
  status: string;
  registros_processados: number;
  mensagem_erro: string | null;
};

type ExecucaoAtual = {
  id: number;
  empresa_nome: string;
  api_tipo: string;
  job_label: string;
  iniciado_em: string;
};

function formatarData(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

function labelApi(tipo: string) {
  return API_TIPO_LABEL[tipo] || tipo;
}

export default function LogsPage() {
  const { profile } = useAuth();
  const podeEditar = profile?.role === "adm" || profile?.role === "gerencia";

  const [logs, setLogs] = useState<Log[]>([]);
  const [execucaoAtual, setExecucaoAtual] = useState<ExecucaoAtual | null>(null);
  const [loading, setLoading] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [filtroStatus, setFiltroStatus] = useState<string>("");

  async function carregarLogs() {
    let q = supabase
      .from("api_sync_log")
      .select("*")
      .order("iniciado_em", { ascending: false })
      .limit(200);

    if (filtroStatus) {
      q = q.eq("status", filtroStatus);
    }

    const { data } = await q;
    setLogs(data || []);
  }

  async function carregarExecucaoAtual() {
    const { data } = await supabase
      .from("api_sync_execucao_atual")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    setExecucaoAtual(data || null);
  }

  async function carregar() {
    setLoading(true);
    await Promise.all([carregarLogs(), carregarExecucaoAtual()]);
    setLoading(false);
    setAtualizando(false);
  }

  async function handleAtualizar() {
    setAtualizando(true);
    await carregar();
  }

  useEffect(() => {
    carregar();
  }, [filtroStatus]);

  useEffect(() => {
    const interval = setInterval(carregarExecucaoAtual, 3000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <p>Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Logs da API</h1>
      <p className="text-slate-600 mt-1">
        Histórico de execuções da sincronização Omie — sucesso, erro e quantidade de registros.
      </p>

      {execucaoAtual && (
        <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <h2 className="text-sm font-semibold text-amber-800 mb-2">Em execução</h2>
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <span>
              <strong>Grupo/Job:</strong> {execucaoAtual.job_label || "—"}
            </span>
            <span>
              <strong>Empresa:</strong> {execucaoAtual.empresa_nome}
            </span>
            <span>
              <strong>API:</strong> {labelApi(execucaoAtual.api_tipo)}
            </span>
            <span className="text-amber-700">
              {formatarData(execucaoAtual.iniciado_em)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="animate-pulse w-2 h-2 bg-amber-500 rounded-full" />
              Sincronizando...
            </span>
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2 flex-wrap items-center">
        <label className="flex items-center gap-2">
          <span>Filtro:</span>
          <select
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="px-3 py-2 border rounded"
          >
            <option value="">Todos</option>
            <option value="sucesso">Sucesso</option>
            <option value="erro">Erro</option>
          </select>
        </label>
        {podeEditar && (
          <button
            type="button"
            onClick={handleAtualizar}
            disabled={atualizando}
            className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {atualizando ? "Atualizando…" : "Atualizar"}
          </button>
        )}
        {!podeEditar && (
          <p className="text-amber-700 text-sm">Somente visualização. Atualizar permitido para Admin e Gerência.</p>
        )}
      </div>

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b bg-slate-100">
            <th className="text-left p-2">Data/Hora</th>
            <th className="text-left p-2">Empresa</th>
            <th className="text-left p-2">API</th>
            <th className="text-left p-2">Status</th>
            <th className="text-right p-2">Registros</th>
            <th className="text-left p-2">Erro</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id} className="border-b">
              <td className="p-2 text-sm">{formatarData(log.iniciado_em)}</td>
              <td className="p-2">{log.empresa_nome}</td>
              <td className="p-2">{labelApi(log.api_tipo)}</td>
              <td className="p-2">
                <span
                  className={`px-2 py-0.5 rounded text-sm ${
                    log.status === "sucesso" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                  }`}
                >
                  {log.status}
                </span>
              </td>
              <td className="p-2 text-right">{log.registros_processados}</td>
              <td className="p-2 text-sm text-red-600 max-w-xs truncate" title={log.mensagem_erro || ""}>
                {log.mensagem_erro || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {logs.length === 0 && <p className="text-slate-500 py-4">Nenhum log encontrado.</p>}
    </div>
  );
}
