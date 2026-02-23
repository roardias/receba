"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const TIMEZONE = "America/Sao_Paulo"; // UTC-3 (Brasília)
const DIAS_SEMANA = [
  { valor: 1, label: "Seg" },
  { valor: 2, label: "Ter" },
  { valor: 3, label: "Qua" },
  { valor: 4, label: "Qui" },
  { valor: 5, label: "Sex" },
  { valor: 6, label: "Sáb" },
  { valor: 7, label: "Dom" },
];

const APIS_DISPONIVEIS = [
  { id: "clientes", label: "Cadastro (clientes)" },
  { id: "categorias", label: "Categorias" },
  { id: "movimento_financeiro", label: "Movimento Financeiro" },
  { id: "pagamentos_realizados", label: "Pagamentos Realizados" },
  { id: "recebimentos_omie", label: "Recebimentos Omie" },
];

type Grupo = { id: string; nome: string };
type Empresa = { id: string; nome_curto: string; grupo_id: string | null };
type Agendamento = {
  id: string;
  api_tipos: string[];
  grupo_ids: string[];
  empresa_ids: string[];
  dias_semana: number[];
  horarios: string[];
  timezone: string;
  ativo: boolean;
  pagamentos_data_de?: string | null;
  pagamentos_data_ate?: string | null;
};

export default function AgendamentosPage() {
  const { profile } = useAuth();
  const podeEditar = profile?.role === "adm" || profile?.role === "gerencia";

  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<Agendamento | null>(null);
  const [apiTipos, setApiTipos] = useState<string[]>([]);
  const [tipo, setTipo] = useState<"grupo" | "empresa">("grupo");
  const [grupoIds, setGrupoIds] = useState<string[]>([]);
  const [empresaIds, setEmpresaIds] = useState<string[]>([]);
  const [diasSemana, setDiasSemana] = useState<number[]>([]);
  const [horarios, setHorarios] = useState<string[]>(["08:00"]);
  const [ativo, setAtivo] = useState(true);
  const [pagamentosDataDe, setPagamentosDataDe] = useState("");
  const [pagamentosDataAte, setPagamentosDataAte] = useState("");

  async function carregar() {
    const [resAg, resGrupos, resEmpresas] = await Promise.all([
      supabase
        .from("api_agendamento")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("grupos").select("id, nome").order("nome"),
      supabase.from("empresas").select("id, nome_curto, grupo_id").order("nome_curto"),
    ]);
    setAgendamentos(resAg.data || []);
    setGrupos(resGrupos.data || []);
    setEmpresas(resEmpresas.data || []);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  function toggleApi(id: string) {
    setApiTipos((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  function toggleDia(val: number) {
    setDiasSemana((prev) =>
      prev.includes(val) ? prev.filter((d) => d !== val) : [...prev, val].sort()
    );
  }

  function toggleGrupo(id: string) {
    setGrupoIds((prev) =>
      prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]
    );
  }

  function toggleEmpresa(id: string) {
    setEmpresaIds((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  }

  function addHorario() {
    setHorarios((prev) => [...prev, "08:00"]);
  }

  function removerHorario(i: number) {
    setHorarios((prev) => prev.filter((_, idx) => idx !== i));
  }

  function alterarHorario(i: number, v: string) {
    setHorarios((prev) => prev.map((h, idx) => (idx === i ? v : h)));
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();

    if (apiTipos.length === 0) {
      alert("Selecione pelo menos uma API para agendar.");
      return;
    }
    if (apiTipos.includes("pagamentos_realizados")) {
      if (!pagamentosDataDe?.trim() || !pagamentosDataAte?.trim()) {
        alert("Para Pagamentos Realizados, informe o período: Data de e Data até.");
        return;
      }
    }
    if (tipo === "grupo" && grupoIds.length === 0) {
      alert("Selecione pelo menos um grupo.");
      return;
    }
    if (tipo === "empresa" && empresaIds.length === 0) {
      alert("Selecione pelo menos uma empresa.");
      return;
    }
    if (diasSemana.length === 0) {
      alert("Selecione pelo menos um dia da semana.");
      return;
    }
    const hFiltrados = horarios
      .filter((h) => h.trim())
      .map((h) => {
        const p = h.trim().split(":");
        const hr = parseInt(p[0] || "0", 10);
        const min = parseInt(p[1] || "0", 10);
        return `${hr.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`;
      });
    if (hFiltrados.length === 0) {
      alert("Informe pelo menos um horário.");
      return;
    }

    // DD/MM/AAAA para o backend (input type=date envia YYYY-MM-DD)
    const toDDMMAAAA = (s: string) => {
      if (!s || s.length < 10) return "";
      const [y, m, d] = s.split("-");
      return `${d}/${m}/${y}`;
    };
    const payload: Record<string, unknown> = {
      api_tipos: apiTipos,
      grupo_ids: tipo === "grupo" ? grupoIds : [],
      empresa_ids: tipo === "empresa" ? empresaIds : [],
      dias_semana: diasSemana,
      horarios: hFiltrados,
      timezone: TIMEZONE,
      ativo,
    };
    if (apiTipos.includes("pagamentos_realizados")) {
      payload.pagamentos_data_de = toDDMMAAAA(pagamentosDataDe);
      payload.pagamentos_data_ate = toDDMMAAAA(pagamentosDataAte);
    } else {
      payload.pagamentos_data_de = null;
      payload.pagamentos_data_ate = null;
    }

    let error = null;
    if (editando) {
      const { error: err } = await supabase.from("api_agendamento").update(payload).eq("id", editando.id);
      error = err;
      if (!err) setEditando(null);
    } else {
      const { error: err } = await supabase.from("api_agendamento").insert(payload);
      error = err;
    }

    if (error) {
      alert(`Erro ao salvar: ${error.message}`);
      return;
    }

    limparForm();
    carregar();
  }

  function limparForm() {
    setApiTipos([]);
    setTipo("grupo");
    setGrupoIds([]);
    setEmpresaIds([]);
    setDiasSemana([]);
    setHorarios(["08:00"]);
    setAtivo(true);
    setPagamentosDataDe("");
    setPagamentosDataAte("");
  }

  async function excluir(id: string) {
    if (!confirm("Excluir este agendamento?")) return;
    await supabase.from("api_agendamento").delete().eq("id", id);
    carregar();
  }

  // Converte DD/MM/AAAA (banco) para YYYY-MM-DD (input type=date)
  function fromDDMMAAAA(s: string | null | undefined): string {
    if (!s || !s.trim()) return "";
    const parts = s.trim().split("/");
    if (parts.length !== 3) return "";
    const [d, m, y] = parts;
    if (d.length <= 2 && m.length <= 2 && y.length === 4) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return "";
  }

  function iniciarEdicao(a: Agendamento) {
    setEditando(a);
    setApiTipos(a.api_tipos || ["clientes"]);
    const temGrupos = (a.grupo_ids || []).length > 0;
    setTipo(temGrupos ? "grupo" : "empresa");
    setGrupoIds(a.grupo_ids || []);
    setEmpresaIds(a.empresa_ids || []);
    setDiasSemana(a.dias_semana || []);
    setHorarios(a.horarios?.length ? a.horarios : ["08:00"]);
    setAtivo(a.ativo ?? true);
    setPagamentosDataDe(fromDDMMAAAA(a.pagamentos_data_de));
    setPagamentosDataAte(fromDDMMAAAA(a.pagamentos_data_ate));
  }

  function cancelarEdicao() {
    setEditando(null);
    limparForm();
  }

  function labelApis(a: Agendamento) {
    const tips = a.api_tipos || ["clientes"];
    return tips.map((t) => APIS_DISPONIVEIS.find((x) => x.id === t)?.label || t).join(", ");
  }

  function labelTargets(a: Agendamento) {
    const nomesGrupos = (a.grupo_ids || [])
      .map((gid) => grupos.find((g) => g.id === gid)?.nome)
      .filter(Boolean);
    const nomesEmpresas = (a.empresa_ids || [])
      .map((eid) => empresas.find((e) => e.id === eid)?.nome_curto)
      .filter(Boolean);
    const parts = nomesGrupos.length ? nomesGrupos : nomesEmpresas;
    return parts.length ? parts.join(", ") : "—";
  }

  function setarTipo(t: "grupo" | "empresa") {
    setTipo(t);
    if (t === "grupo") setEmpresaIds([]);
    else setGrupoIds([]);
  }

  if (loading) return <p>Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Agendamentos API</h1>
      <p className="text-slate-600 mt-1">
        1º escolha as APIs | 2º grupo ou empresa | 3º dias e horários. Fuso UTC-3 (Brasília).
      </p>
      {!podeEditar && (
        <p className="mt-2 text-amber-700 text-sm">Somente visualização. Alterações permitidas para Admin e Gerência.</p>
      )}

      {podeEditar && (
      <form onSubmit={salvar} className="mt-6 space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium mb-2">1. APIs a agendar (marque uma ou mais)</label>
          <div className="flex flex-wrap gap-2">
            {APIS_DISPONIVEIS.map((api) => (
              <label
                key={api.id}
                className="flex items-center gap-1 px-3 py-2 border rounded cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={apiTipos.includes(api.id)}
                  onChange={() => toggleApi(api.id)}
                />
                {api.label}
              </label>
            ))}
          </div>
          {apiTipos.includes("pagamentos_realizados") && (
            <div className="mt-3 p-3 bg-slate-50 border rounded space-y-2">
              <span className="text-sm font-medium text-slate-700">Período para Pagamentos Realizados</span>
              <div className="flex flex-wrap gap-4 items-center">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Data de</span>
                  <input
                    type="date"
                    value={pagamentosDataDe}
                    onChange={(e) => setPagamentosDataDe(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Data até</span>
                  <input
                    type="date"
                    value={pagamentosDataAte}
                    onChange={(e) => setPagamentosDataAte(e.target.value)}
                    className="border rounded px-2 py-1"
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">2. Aplicar a</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tipo"
                checked={tipo === "grupo"}
                onChange={() => setarTipo("grupo")}
              />
              Grupo
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="tipo"
                checked={tipo === "empresa"}
                onChange={() => setarTipo("empresa")}
              />
              Empresa
            </label>
          </div>
        </div>

        {tipo === "grupo" && (
          <div>
            <label className="block text-sm font-medium mb-2">Grupos (marque um ou mais)</label>
            <div className="flex flex-wrap gap-2">
              {grupos.map((g) => (
                <label
                  key={g.id}
                  className="flex items-center gap-1 px-3 py-2 border rounded cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={grupoIds.includes(g.id)}
                    onChange={() => toggleGrupo(g.id)}
                  />
                  {g.nome}
                </label>
              ))}
              {grupos.length === 0 && (
                <span className="text-slate-500 text-sm">Nenhum grupo cadastrado.</span>
              )}
            </div>
          </div>
        )}

        {tipo === "empresa" && (
          <div>
            <label className="block text-sm font-medium mb-2">Empresas (marque uma ou mais)</label>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {empresas.map((e) => (
                <label
                  key={e.id}
                  className="flex items-center gap-1 px-3 py-2 border rounded cursor-pointer hover:bg-slate-50 whitespace-nowrap"
                >
                  <input
                    type="checkbox"
                    checked={empresaIds.includes(e.id)}
                    onChange={() => toggleEmpresa(e.id)}
                  />
                  {e.nome_curto}
                </label>
              ))}
              {empresas.length === 0 && (
                <span className="text-slate-500 text-sm">Nenhuma empresa cadastrada.</span>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2">3. Dias da semana</label>
          <div className="flex gap-2 flex-wrap">
            {DIAS_SEMANA.map((d) => (
              <label
                key={d.valor}
                className="flex items-center gap-1 px-3 py-2 border rounded cursor-pointer hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={diasSemana.includes(d.valor)}
                  onChange={() => toggleDia(d.valor)}
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">4. Horários (UTC-3)</label>
          <div className="space-y-2">
            {horarios.map((h, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="time"
                  value={h}
                  onChange={(e) => alterarHorario(i, e.target.value)}
                  className="px-3 py-2 border rounded w-32"
                />
                <button
                  type="button"
                  onClick={() => removerHorario(i)}
                  className="text-red-600 text-sm"
                >
                  Remover
                </button>
              </div>
            ))}
            <button type="button" onClick={addHorario} className="text-blue-600 text-sm">
              + Adicionar horário
            </button>
          </div>
        </div>

        <div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
            Ativo
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700"
          >
            {editando ? "Atualizar" : "Adicionar"}
          </button>
          {editando && (
            <button type="button" onClick={cancelarEdicao} className="px-4 py-2 border rounded">
              Cancelar
            </button>
          )}
        </div>
      </form>
      )}

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4">Agendamentos cadastrados</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-slate-100">
              <th className="text-left p-2">APIs</th>
              <th className="text-left p-2">Grupo(s) / Empresa(s)</th>
              <th className="text-left p-2">Dias</th>
              <th className="text-left p-2">Horários</th>
              <th className="text-left p-2">Ativo</th>
              {podeEditar && <th className="text-left p-2">Ações</th>}
            </tr>
          </thead>
          <tbody>
            {agendamentos.map((a) => (
              <tr key={a.id} className="border-b">
                <td className="p-2">{labelApis(a)}</td>
                <td className="p-2">{labelTargets(a)}</td>
                <td className="p-2">
                  {(a.dias_semana || [])
                    .sort()
                    .map((d) => DIAS_SEMANA.find((x) => x.valor === d)?.label || d)
                    .join(", ")}
                </td>
                <td className="p-2">{(a.horarios || []).join(", ")}</td>
                <td className="p-2">{a.ativo ? "Sim" : "Não"}</td>
                {podeEditar && (
                  <td className="p-2 flex gap-2">
                    <button
                      onClick={() => iniciarEdicao(a)}
                      className="text-blue-600 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => excluir(a.id)}
                      className="text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {agendamentos.length === 0 && (
          <p className="text-slate-500 py-4">Nenhum agendamento cadastrado.</p>
        )}
      </div>
    </div>
  );
}
