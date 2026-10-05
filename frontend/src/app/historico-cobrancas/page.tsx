"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Cobranca = {
  id: string;
  created_at: string;
  data_contato: string | null;
  tipo: "email" | "ligacao" | "whatsapp";
  telefone_contato: string | null;
  telefone_tipo: string | null;
  cliente_nome: string | null;
  grupo_nome: string | null;
  empresas_internas_nomes: string | null;
  observacao: string | null;
  cod_cliente: string | null;
  cnpj_cpf: string | null;
  grupo_id: string | null;
  empresa_id: string | null;
};

function soNumeros(s: string): string {
  return (s || "").replace(/\D/g, "");
}

function formataData(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T12:00:00" : "")).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formaContato(tipo: string): string {
  switch (tipo) {
    case "email": return "E-mail";
    case "ligacao": return "Ligação";
    case "whatsapp": return "WhatsApp";
    default: return tipo;
  }
}

function formataTelefone(num: string | null): string {
  if (!num || !/^\d+$/.test(num)) return "—";
  const d = num.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 3)} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return num;
}

const COBRANCAS_COLUNAS = "id, created_at, data_contato, tipo, telefone_contato, telefone_tipo, cliente_nome, grupo_nome, empresas_internas_nomes, observacao, cod_cliente, cnpj_cpf, grupo_id, empresa_id";

export default function HistoricoCobrancasPage() {
  const { hasPermissao, user } = useAuth();
  const [busca, setBusca] = useState("");
  const [buscaDebounced, setBuscaDebounced] = useState("");
  /** Filtro por Data contato (aplica na tabela e na exportação). Vazio = sem limite. */
  const [filtroDataDe, setFiltroDataDe] = useState("");
  const [filtroDataAte, setFiltroDataAte] = useState("");
  /** Filtro por grupo/empresas (mesmo padrão da Relação de Inadimplentes). */
  const [gruposLista, setGruposLista] = useState<{ id: string; nome: string }[]>([]);
  const [empresasLista, setEmpresasLista] = useState<{ id: string; nome_curto: string; grupo_id: string | null }[]>([]);
  const [filtroGrupoId, setFiltroGrupoId] = useState("");
  const [empresasSelecionadasIds, setEmpresasSelecionadasIds] = useState<string[]>([]);
  const [filtroEmpresaPainelAberto, setFiltroEmpresaPainelAberto] = useState(false);
  const filtroEmpresaRef = useRef<HTMLDivElement>(null);
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowedGrupoIds, setAllowedGrupoIds] = useState<Set<string>>(new Set());
  const [allowedEmpresaIds, setAllowedEmpresaIds] = useState<Set<string>>(new Set());
  const [visibilidadeCarregada, setVisibilidadeCarregada] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [editingObsId, setEditingObsId] = useState<string | null>(null);
  const [editingObsValue, setEditingObsValue] = useState("");
  const [editingDataContato, setEditingDataContato] = useState("");
  const [editingTelefone, setEditingTelefone] = useState("");
  const [editingTelefoneTipo, setEditingTelefoneTipo] = useState<"celular" | "fixo" | null>(null);
  const [savingObsId, setSavingObsId] = useState<string | null>(null);

  const hojeStr = new Date().toISOString().slice(0, 10);

  // Carrega visibilidade do usuário (grupos/empresas que pode ver). Vazio = vê todos.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const uid = user?.id;
      if (!uid) {
        setVisibilidadeCarregada(true);
        return;
      }
      const [resPG, resPE] = await Promise.all([
        supabase.from("perfis_grupos").select("grupo_id").eq("perfil_id", uid),
        supabase.from("perfis_empresas").select("empresa_id").eq("perfil_id", uid),
      ]);
      if (cancelled) return;
      const pg = (resPG.data || []) as { grupo_id: string }[];
      const pe = (resPE.data || []) as { empresa_id: string }[];
      setAllowedGrupoIds(pg.length ? new Set(pg.map((r) => r.grupo_id)) : new Set());
      setAllowedEmpresaIds(pe.length ? new Set(pe.map((r) => r.empresa_id)) : new Set());
      setVisibilidadeCarregada(true);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Carrega grupos/empresas para o filtro, respeitando a visibilidade (mesma regra da Relação de Inadimplentes)
  useEffect(() => {
    if (!visibilidadeCarregada) return;
    let cancelled = false;
    (async () => {
      const [resG, resE] = await Promise.all([
        supabase.from("grupos").select("id, nome").order("nome"),
        supabase.from("empresas").select("id, nome_curto, grupo_id").order("nome_curto"),
      ]);
      if (cancelled) return;
      const gruposAll = (resG.data || []) as { id: string; nome: string }[];
      const empresasAll = (resE.data || []) as { id: string; nome_curto: string; grupo_id: string | null }[];
      const gIds = allowedGrupoIds.size > 0 ? allowedGrupoIds : null;
      const eIds = allowedEmpresaIds.size > 0 ? allowedEmpresaIds : null;
      setGruposLista(gIds ? gruposAll.filter((g) => gIds.has(g.id)) : gruposAll);
      setEmpresasLista(
        gIds && eIds
          ? empresasAll.filter((e) => (e.grupo_id != null && gIds.has(e.grupo_id)) || eIds.has(e.id))
          : gIds
            ? empresasAll.filter((e) => e.grupo_id != null && gIds.has(e.grupo_id))
            : eIds
              ? empresasAll.filter((e) => eIds.has(e.id))
              : empresasAll
      );
    })();
    return () => { cancelled = true; };
  }, [visibilidadeCarregada, allowedGrupoIds, allowedEmpresaIds]);

  const empresasDoGrupo = useMemo(
    () => (filtroGrupoId ? empresasLista.filter((e) => e.grupo_id === filtroGrupoId) : []),
    [empresasLista, filtroGrupoId]
  );

  // Ao escolher/trocar o grupo, todas as empresas dele vêm marcadas (padrão)
  useEffect(() => {
    setEmpresasSelecionadasIds(
      filtroGrupoId ? empresasLista.filter((e) => e.grupo_id === filtroGrupoId).map((e) => e.id) : []
    );
  }, [filtroGrupoId, empresasLista]);

  const empresasSelecionadas = empresasDoGrupo.filter((e) => empresasSelecionadasIds.includes(e.id));
  const todasEmpresasMarcadas = empresasDoGrupo.length > 0 && empresasSelecionadas.length === empresasDoGrupo.length;

  function toggleEmpresaSelecionada(id: string) {
    setEmpresasSelecionadasIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // Fecha o painel de empresas ao clicar fora ou apertar Esc
  useEffect(() => {
    if (!filtroEmpresaPainelAberto) return;
    function handlePointerDown(e: PointerEvent) {
      const root = filtroEmpresaRef.current;
      if (!root || root.contains(e.target as Node)) return;
      setFiltroEmpresaPainelAberto(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFiltroEmpresaPainelAberto(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [filtroEmpresaPainelAberto]);

  // Debounce da busca: só atualiza após 500ms sem digitar (evita consulta a cada letra)
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca), 500);
    return () => clearTimeout(t);
  }, [busca]);

  // Ao voltar para a aba/janela, refaz a consulta (evita dados desatualizados após UPDATE no banco)
  useEffect(() => {
    const onFocus = () => setRefreshKey((k) => k + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Carrega cobranças respeitando visibilidade (grupo/empresa) e filtro de busca
  useEffect(() => {
    if (!visibilidadeCarregada) return;
    setLoading((prev) => (cobrancas.length === 0 ? true : prev));
    let cancelled = false;
    (async () => {
      const buscaNorm = buscaDebounced.trim();
      let query = supabase
        .from("cobrancas_realizadas")
        .select(COBRANCAS_COLUNAS)
        .order("data_contato", { ascending: false, nullsFirst: false });

      // Restrição por grupo/empresa: se usuário tem perfis_grupos ou perfis_empresas, filtra
      const hasGrupos = allowedGrupoIds.size > 0;
      const hasEmpresas = allowedEmpresaIds.size > 0;
      if (hasGrupos && hasEmpresas) {
        query = query.or(
          `grupo_id.in.(${Array.from(allowedGrupoIds).join(",")}),empresa_id.in.(${Array.from(allowedEmpresaIds).join(",")})`
        );
      } else if (hasGrupos) {
        query = query.in("grupo_id", Array.from(allowedGrupoIds));
      } else if (hasEmpresas) {
        query = query.in("empresa_id", Array.from(allowedEmpresaIds));
      }

      if (buscaNorm) {
        const padrao = `%${buscaNorm.replace(/"/g, '""')}%`;
        query = query.or(
          `cliente_nome.ilike."${padrao}",cod_cliente.ilike."${padrao}",grupo_nome.ilike."${padrao}"`
        );
      }

      const { data: cobrancasData, error: errCob } = await query;
      if (cancelled) return;
      if (errCob) {
        console.error(errCob);
        setCobrancas([]);
      } else {
        setCobrancas((cobrancasData || []) as Cobranca[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [buscaDebounced, visibilidadeCarregada, refreshKey, allowedGrupoIds, allowedEmpresaIds]);

  function validaTelefoneEdicao(telefone: string, tipo: "celular" | "fixo" | null): { ok: boolean; msg?: string; valor?: string | null } {
    const nums = soNumeros(telefone);
    if (!nums) return { ok: true, valor: null };
    if (!tipo) return { ok: false, msg: "Para preencher telefone, informe se é celular ou fixo." };
    if (tipo === "celular" && nums.length !== 11) return { ok: false, msg: "Celular deve ter 11 dígitos." };
    if (tipo === "fixo" && nums.length !== 10) return { ok: false, msg: "Fixo deve ter 10 dígitos." };
    return { ok: true, valor: nums };
  }

  async function salvarObs(
    id: string,
    valor: string,
    dataContato: string,
    telefone: string,
    telefoneTipo: "celular" | "fixo" | null
  ) {
    if (dataContato && dataContato > hojeStr) {
      alert("A data de contato não pode ser futura.");
      return;
    }
    const tel = validaTelefoneEdicao(telefone, telefoneTipo);
    if (!tel.ok) {
      alert(tel.msg);
      return;
    }
    setSavingObsId(id);
    const dataContatoVal = dataContato.trim() || null;
    const payload = {
      observacao: valor.trim() || null,
      data_contato: dataContatoVal,
      telefone_contato: tel.valor ?? null,
      telefone_tipo: tel.valor ? telefoneTipo : null,
    };
    const { error } = await supabase.from("cobrancas_realizadas").update(payload).eq("id", id);
    setSavingObsId(null);
    setEditingObsId(null);
    if (error) {
      console.error(error);
      alert("Não foi possível salvar. Tente novamente.");
      return;
    }
    setCobrancas((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, observacao: valor.trim() || null, data_contato: dataContatoVal, telefone_contato: payload.telefone_contato, telefone_tipo: payload.telefone_tipo }
          : c
      )
    );
    setRefreshKey((k) => k + 1);
    // Atualiza a view/materialized view usada na tela Relação inadimplentes
    void supabase.rpc("refresh_dashboard_receber").then(
      () => {},
      () => {}
    );
  }

  /** Data efetiva do contato (mesma regra da coluna da tabela: data_contato ou data de criação). */
  function dataEfetiva(c: Cobranca): string {
    return (c.data_contato || c.created_at).slice(0, 10);
  }

  const cobrancasVisiveis = useMemo(() => {
    // Empresa do registro: pelo empresa_id (quando 1 só foi selecionada ao registrar)
    // ou pelos nomes em empresas_internas_nomes (lista separada por vírgula).
    const nomesSelecionados = new Set(
      empresasSelecionadas.map((e) => e.nome_curto.trim().toLowerCase())
    );
    const idsSelecionados = new Set(empresasSelecionadas.map((e) => e.id));
    const filtrarPorEmpresa = !!filtroGrupoId && !todasEmpresasMarcadas;

    return cobrancas.filter((c) => {
      const d = dataEfetiva(c);
      if (filtroDataDe && d < filtroDataDe) return false;
      if (filtroDataAte && d > filtroDataAte) return false;
      if (filtroGrupoId && c.grupo_id !== filtroGrupoId) return false;
      if (filtrarPorEmpresa) {
        if (c.empresa_id && idsSelecionados.has(c.empresa_id)) return true;
        const nomesDoRegistro = (c.empresas_internas_nomes || "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        return nomesDoRegistro.some((n) => nomesSelecionados.has(n));
      }
      return true;
    });
  }, [cobrancas, filtroDataDe, filtroDataAte, filtroGrupoId, todasEmpresasMarcadas, empresasSelecionadas]);

  function exportarCsv() {
    const sep = ";";
    const esc = (v: string) => `"${(v || "").replace(/"/g, '""')}"`;
    const cabecalho = ["Grupo", "Cliente", "CNPJ/CPF", "Telefone", "Data contato", "Forma de contato", "Observação"];
    const linhas = [
      cabecalho.map(esc).join(sep),
      ...cobrancasVisiveis.map((c) => {
        const tel = formataTelefone(c.telefone_contato);
        return [
          c.grupo_nome ?? "",
          c.cliente_nome ?? "",
          c.cnpj_cpf ?? "",
          tel === "—" ? "" : tel,
          formataData(c.data_contato || c.created_at),
          formaContato(c.tipo),
          c.observacao ?? "",
        ].map(esc).join(sep);
      }),
    ];
    // BOM (\uFEFF) para o Excel abrir os acentos corretamente; separador ";" abre em colunas no Excel BR
    const blob = new Blob(["\uFEFF" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const sufixo = filtroDataDe || filtroDataAte ? `_${filtroDataDe || "inicio"}_a_${filtroDataAte || "hoje"}` : "";
    a.href = url;
    a.download = `historico-cobrancas${sufixo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function iniciarEditarObs(c: Cobranca) {
    setEditingObsId(c.id);
    setEditingObsValue(c.observacao ?? "");
    setEditingDataContato(c.data_contato || c.created_at.slice(0, 10));
    setEditingTelefone(c.telefone_contato ?? "");
    setEditingTelefoneTipo((c.telefone_tipo === "celular" || c.telefone_tipo === "fixo" ? c.telefone_tipo : null) as "celular" | "fixo" | null);
  }

  if (!hasPermissao("menu_historico_cobrancas")) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Histórico de cobranças</h1>
        <p className="text-slate-600 mt-1">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  // Só mostra tela de "Carregando..." na carga inicial (sem dados). Em buscas, mantém formulário para o cursor não sair do campo.
  if (loading && cobrancas.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Histórico de cobranças por cliente</h1>
        <p className="text-slate-600 mt-1">Carregando...</p>
      </div>
    );
  }

  const podeEditarObs = hasPermissao("historico_cobrancas_editar");

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">
        Histórico de cobranças por cliente
      </h1>
      <p className="text-slate-600 mt-1">
        Lista de registros da tabela de cobranças realizadas. Busca por cliente, código ou grupo.
      </p>

      <div className="mt-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Buscar</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Cliente, código ou grupo"
            className="px-4 py-2 border rounded bg-white min-w-[260px]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
          <select
            value={filtroGrupoId}
            onChange={(e) => { setFiltroGrupoId(e.target.value); setFiltroEmpresaPainelAberto(false); }}
            className="px-4 py-2 border rounded bg-white min-w-[180px]"
          >
            <option value="">Todos os grupos</option>
            {gruposLista.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">Empresa</span>
          <div
            ref={filtroEmpresaRef}
            className={`relative border border-slate-300 rounded bg-white min-w-[220px] ${!filtroGrupoId ? "opacity-60" : ""}`}
          >
            <button
              type="button"
              aria-expanded={filtroEmpresaPainelAberto}
              aria-haspopup="listbox"
              disabled={!filtroGrupoId}
              onClick={() => setFiltroEmpresaPainelAberto((aberto) => !aberto)}
              className="w-full text-left cursor-pointer px-4 py-2 pr-8 text-sm text-slate-800 hover:bg-slate-50 rounded disabled:cursor-not-allowed"
            >
              <span
                className="block truncate max-w-[240px]"
                title={empresasSelecionadas.map((e) => e.nome_curto).join(", ") || "Nenhuma empresa selecionada"}
              >
                {!filtroGrupoId
                  ? "Selecione o grupo primeiro"
                  : todasEmpresasMarcadas
                    ? `Todas as empresas (${empresasDoGrupo.length})`
                    : empresasSelecionadas.length === 0
                      ? "Nenhuma empresa selecionada"
                      : `${empresasSelecionadas.length} de ${empresasDoGrupo.length} empresas`}
              </span>
            </button>
            {filtroEmpresaPainelAberto && filtroGrupoId ? (
              <div className="absolute left-0 top-full mt-1 z-50 min-w-full max-h-64 overflow-y-auto rounded border border-slate-200 bg-white py-2 shadow-lg">
                <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50 font-medium">
                  <input
                    type="checkbox"
                    checked={todasEmpresasMarcadas}
                    onChange={() =>
                      setEmpresasSelecionadasIds(
                        todasEmpresasMarcadas ? [] : empresasDoGrupo.map((e) => e.id)
                      )
                    }
                    className="rounded border-slate-300"
                  />
                  <span>Marcar todas</span>
                </label>
                <div className="border-t border-slate-100 my-1" />
                {empresasDoGrupo.map((e) => (
                  <label
                    key={e.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={empresasSelecionadasIds.includes(e.id)}
                      onChange={() => toggleEmpresaSelecionada(e.id)}
                      className="rounded border-slate-300"
                    />
                    <span>{e.nome_curto}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Data contato — de</label>
          <input
            type="date"
            value={filtroDataDe}
            max={filtroDataAte || undefined}
            onChange={(e) => setFiltroDataDe(e.target.value)}
            className="px-4 py-2 border rounded bg-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Data contato — até</label>
          <input
            type="date"
            value={filtroDataAte}
            min={filtroDataDe || undefined}
            onChange={(e) => setFiltroDataAte(e.target.value)}
            className="px-4 py-2 border rounded bg-white"
          />
        </div>
        {(filtroDataDe || filtroDataAte) && (
          <button
            type="button"
            onClick={() => { setFiltroDataDe(""); setFiltroDataAte(""); }}
            className="px-3 py-2 text-sm text-slate-600 rounded hover:bg-slate-200"
          >
            Limpar datas
          </button>
        )}
        <button
          type="button"
          onClick={exportarCsv}
          disabled={cobrancasVisiveis.length === 0}
          className="px-4 py-2 rounded bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
          title="Exporta para CSV os registros visíveis (respeita a busca e o filtro de datas)."
        >
          Exportar CSV ({cobrancasVisiveis.length})
        </button>
      </div>

      <div className="mt-6">
        {cobrancasVisiveis.length === 0 ? (
          <p className="text-slate-500">Nenhuma cobrança encontrada.</p>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-16rem)] border rounded bg-white">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100 shadow-sm">
                <tr>
                  <th className="text-left p-2">Grupo</th>
                  <th className="text-left p-2">Cliente</th>
                  <th className="text-left p-2">CNPJ/CPF</th>
                  <th className="text-left p-2">Telefone</th>
                  <th className="text-left p-2">Data contato</th>
                  <th className="text-left p-2">Forma de contato</th>
                  <th className="text-left p-2">Observação</th>
                </tr>
              </thead>
              <tbody>
                {cobrancasVisiveis.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-2 text-slate-600">{c.grupo_nome ?? "—"}</td>
                    <td className="p-2 text-slate-800">
                      <div className="flex flex-col">
                        <span>{c.cliente_nome || "—"}</span>
                        {c.cod_cliente && (
                          <span className="text-xs text-slate-500">Cód. {c.cod_cliente}</span>
                        )}
                      </div>
                    </td>
                    <td className="p-2 text-slate-600 whitespace-nowrap">
                      {c.cnpj_cpf || "—"}
                    </td>
                    <td className="p-2 text-slate-600 whitespace-nowrap">
                      {podeEditarObs && editingObsId === c.id ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex gap-2">
                            <label className="inline-flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                name={`tipoTel-${c.id}`}
                                checked={editingTelefoneTipo === "celular"}
                                onChange={() => setEditingTelefoneTipo("celular")}
                                className="rounded"
                              />
                              Celular
                            </label>
                            <label className="inline-flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                name={`tipoTel-${c.id}`}
                                checked={editingTelefoneTipo === "fixo"}
                                onChange={() => setEditingTelefoneTipo("fixo")}
                                className="rounded"
                              />
                              Fixo
                            </label>
                          </div>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={editingTelefone}
                            onChange={(e) => setEditingTelefone(soNumeros(e.target.value))}
                            placeholder="61999999999"
                            maxLength={11}
                            className="p-1 border rounded text-sm w-28"
                          />
                        </div>
                      ) : (
                        formataTelefone(c.telefone_contato)
                      )}
                    </td>
                    <td className="p-2 text-slate-600">
                      {podeEditarObs && editingObsId === c.id ? (
                        <input
                          type="date"
                          value={editingDataContato}
                          max={hojeStr}
                          onChange={(e) => setEditingDataContato(e.target.value)}
                          className="p-1 border rounded text-sm"
                        />
                      ) : (
                        formataData(c.data_contato || c.created_at)
                      )}
                    </td>
                    <td className="p-2">{formaContato(c.tipo)}</td>
                    <td className="p-2 max-w-md align-top">
                      {podeEditarObs && editingObsId === c.id ? (
                        <div className="flex flex-col gap-1">
                          <textarea
                            value={editingObsValue}
                            onChange={(e) => setEditingObsValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                setEditingObsId(null);
                              }
                            }}
                            className="w-full min-h-[60px] p-2 border rounded text-sm"
                            placeholder="Observação"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                salvarObs(c.id, editingObsValue, editingDataContato, editingTelefone, editingTelefoneTipo)
                              }
                              disabled={savingObsId === c.id}
                              className="px-2 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-50"
                            >
                              {savingObsId === c.id ? "Salvando…" : "Salvar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingObsId(null)}
                              className="px-2 py-1 text-slate-600 text-xs rounded hover:bg-slate-200"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1">
                          <span title={c.observacao || ""} className="flex-1 min-w-0">
                            {c.observacao || "—"}
                          </span>
                          {podeEditarObs && (
                            <button
                              type="button"
                              onClick={() => iniciarEditarObs(c)}
                              className="text-slate-400 hover:text-slate-700 text-xs shrink-0"
                              title="Editar observação"
                            >
                              Editar
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
