"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Grupo = { id: string; nome: string };
type Empresa = { id: string; nome_curto: string; grupo_id: string | null };

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
  const { hasPermissao } = useAuth();
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [grupoId, setGrupoId] = useState<string>("");
  const [empresaId, setEmpresaId] = useState<string>("");
  const [busca, setBusca] = useState("");
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [loading, setLoading] = useState(true);

  const [editingObsId, setEditingObsId] = useState<string | null>(null);
  const [editingObsValue, setEditingObsValue] = useState("");
  const [editingDataContato, setEditingDataContato] = useState("");
  const [editingTelefone, setEditingTelefone] = useState("");
  const [editingTelefoneTipo, setEditingTelefoneTipo] = useState<"celular" | "fixo" | null>(null);
  const [savingObsId, setSavingObsId] = useState<string | null>(null);

  const hojeStr = new Date().toISOString().slice(0, 10);

  // Carrega grupos, empresas e TODAS as cobranças de uma vez
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [
        { data: gruposData },
        { data: empresasData },
        { data: cobrancasData, error: errCob },
      ] = await Promise.all([
        supabase.from("grupos").select("id, nome").order("nome"),
        supabase.from("empresas").select("id, nome_curto, grupo_id").order("nome_curto"),
        supabase
          .from("cobrancas_realizadas")
          .select(COBRANCAS_COLUNAS)
          .order("data_contato", { ascending: false, nullsFirst: false }),
      ]);
      if (cancelled) return;
      setGrupos((gruposData || []) as Grupo[]);
      setEmpresas((empresasData || []) as Empresa[]);
      if (errCob) {
        console.error(errCob);
        setCobrancas([]);
      } else {
        setCobrancas((cobrancasData || []) as Cobranca[]);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const empresasFiltradas = grupoId ? empresas.filter((e) => e.grupo_id === grupoId) : empresas;
  const grupoSelecionado = grupos.find((g) => g.id === grupoId);
  const empresaSelecionada = empresasFiltradas.find((e) => e.id === empresaId);

  // Filtros: Grupo, Empresa e Busca (nome ou CNPJ/CPF) — todos opcionais
  const cobrancasFiltradas = useMemo(() => {
    let list = cobrancas;

    if (grupoId && grupoSelecionado) {
      list = list.filter(
        (c) =>
          c.grupo_id === grupoId ||
          (c.grupo_nome || "").toLowerCase() === grupoSelecionado.nome.toLowerCase()
      );
    }
    if (empresaId && empresaSelecionada) {
      list = list.filter(
        (c) =>
          c.empresa_id === empresaSelecionada.id ||
          (c.empresas_internas_nomes || "").toLowerCase().includes(empresaSelecionada.nome_curto.toLowerCase())
      );
    }

    const buscaNorm = busca.trim();
    if (buscaNorm) {
      const norm = buscaNorm.toLowerCase();
      const soNum = soNumeros(busca);
      list = list.filter((c) => {
        const matchNome = (c.cliente_nome || "").toLowerCase().includes(norm);
        const docNum = soNumeros(c.cnpj_cpf || "");
        const matchDoc = soNum.length >= 2 && docNum.length > 0 && (docNum.includes(soNum) || soNum.includes(docNum));
        return matchNome || matchDoc;
      });
    }

    return list;
  }, [cobrancas, grupoId, grupoSelecionado, empresaId, empresaSelecionada, busca]);

  // Agrupa por cliente (cliente_nome + CNPJ/CPF)
  const porCliente = useMemo(() => {
    const map = new Map<string, Cobranca[]>();
    for (const c of cobrancasFiltradas) {
      const chave = [
        (c.cliente_nome ?? "").trim().toLowerCase(),
        (c.cnpj_cpf ?? "").trim(),
      ].join("|");
      if (!map.has(chave)) map.set(chave, []);
      map.get(chave)!.push(c);
    }
    Array.from(map.values()).forEach((arr) => {
      arr.sort((a, b) => (b.data_contato || b.created_at).localeCompare(a.data_contato || a.created_at));
    });
    return Array.from(map.entries()).sort((a, b) => {
      const nomeA = (a[1][0]?.cliente_nome ?? "").toLowerCase();
      const nomeB = (b[1][0]?.cliente_nome ?? "").toLowerCase();
      return nomeA.localeCompare(nomeB, "pt-BR");
    });
  }, [cobrancasFiltradas]);

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

  if (loading) {
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
        Todos os registros, agrupados por cliente. Use os filtros para refinar.
      </p>

      <div className="mt-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Grupo</label>
          <select
            value={grupoId}
            onChange={(e) => {
              setGrupoId(e.target.value);
              setEmpresaId("");
            }}
            className="px-4 py-2 border rounded bg-white min-w-[200px]"
          >
            <option value="">Todos</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>{g.nome}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Empresa</label>
          <select
            value={empresaId}
            onChange={(e) => setEmpresaId(e.target.value)}
            className="px-4 py-2 border rounded bg-white min-w-[200px]"
            disabled={!grupoId}
          >
            <option value="">Todas</option>
            {empresasFiltradas.map((e) => (
              <option key={e.id} value={e.id}>{e.nome_curto}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Buscar (nome ou CNPJ/CPF)</label>
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nome do cliente ou CNPJ/CPF"
            className="px-4 py-2 border rounded bg-white min-w-[260px]"
          />
        </div>
      </div>

      <div className="mt-6">
        {porCliente.length === 0 ? (
          <p className="text-slate-500">Nenhuma cobrança encontrada.</p>
        ) : (
          <div className="space-y-8">
            {porCliente.map(([chave, itens]) => {
              const primeiro = itens[0];
              const nomeCliente = primeiro?.cliente_nome || "—";
              return (
                <div key={chave}>
                  <h2 className="text-lg font-semibold text-slate-800 border-b border-slate-200 pb-2 mb-3">
                    {nomeCliente}
                    {primeiro?.cod_cliente && (
                      <span className="text-slate-500 font-normal ml-2">Cód. {primeiro.cod_cliente}</span>
                    )}
                  </h2>
                  <div className="overflow-x-auto border rounded bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-100">
                        <tr>
                          <th className="text-left p-2">Grupo</th>
                          <th className="text-left p-2">Forma de contato</th>
                          <th className="text-left p-2">Data contato</th>
                          <th className="text-left p-2">Telefone</th>
                          <th className="text-left p-2">Observação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {itens.map((c) => (
                          <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="p-2 text-slate-600">{c.grupo_nome ?? "—"}</td>
                            <td className="p-2">{formaContato(c.tipo)}</td>
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
                            <td className="p-2 text-slate-600 whitespace-nowrap">
                              {podeEditarObs && editingObsId === c.id ? (
                                <div className="flex flex-col gap-1">
                                  <div className="flex gap-2">
                                    <label className="inline-flex items-center gap-1 text-xs">
                                      <input type="radio" name={`tipoTel-${c.id}`} checked={editingTelefoneTipo === "celular"} onChange={() => setEditingTelefoneTipo("celular")} className="rounded" />
                                      Celular
                                    </label>
                                    <label className="inline-flex items-center gap-1 text-xs">
                                      <input type="radio" name={`tipoTel-${c.id}`} checked={editingTelefoneTipo === "fixo"} onChange={() => setEditingTelefoneTipo("fixo")} className="rounded" />
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
                            <td className="p-2 max-w-md align-top">
                              {podeEditarObs && editingObsId === c.id ? (
                                <div className="flex flex-col gap-1">
                                  <textarea
                                    value={editingObsValue}
                                    onChange={(e) => setEditingObsValue(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === "Escape") setEditingObsId(null); }}
                                    className="w-full min-h-[60px] p-2 border rounded text-sm"
                                    placeholder="Observação"
                                    autoFocus
                                  />
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => salvarObs(c.id, editingObsValue, editingDataContato, editingTelefone, editingTelefoneTipo)}
                                      disabled={savingObsId === c.id}
                                      className="px-2 py-1 bg-slate-700 text-white text-xs rounded hover:bg-slate-600 disabled:opacity-50"
                                    >
                                      {savingObsId === c.id ? "Salvando…" : "Salvar"}
                                    </button>
                                    <button type="button" onClick={() => setEditingObsId(null)} className="px-2 py-1 text-slate-600 text-xs rounded hover:bg-slate-200">
                                      Cancelar
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex items-start gap-1">
                                  <span title={c.observacao || ""} className="flex-1 min-w-0">{c.observacao || "—"}</span>
                                  {podeEditarObs && (
                                    <button type="button" onClick={() => iniciarEditarObs(c)} className="text-slate-400 hover:text-slate-700 text-xs shrink-0" title="Editar observação">
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
