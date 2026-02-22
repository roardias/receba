"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_PERMISSOES_USUARIO } from "@/contexts/AuthContext";

const PERMISSOES_LABELS: Record<string, string> = {
  menu_historico_cobrancas: "Ver histórico de cobranças",
  historico_cobrancas_editar: "Editar observação no histórico",
  dashboard_enviar_email: "Enviar e-mail (no dashboard)",
  dashboard_registrar_ligacao: "Registrar ligação (no dashboard)",
  dashboard_registrar_whatsapp: "Registrar WhatsApp (no dashboard)",
  menu_cadastro_usuarios: "Cadastro de usuários",
  menu_email: "Ver página Envio de e-mail",
  enviar_email_teste: "Enviar e-mail de teste",
  email_configurar: "Configurar e-mail",
  menu_acessorias: "Acessórias",
  menu_agendamentos: "Agendamentos API",
  menu_logs: "Logs API",
  config_grupos_empresas_editar: "Cadastrar/editar grupos e empresas",
  config_minha_empresa_imagem_cor: "Alterar imagem e cor (minha empresa)",
};

const PERMISSOES_GRUPOS: { titulo: string; keys: string[] }[] = [
  { titulo: "Dashboard e histórico", keys: ["menu_historico_cobrancas", "historico_cobrancas_editar", "dashboard_enviar_email", "dashboard_registrar_ligacao", "dashboard_registrar_whatsapp"] },
  { titulo: "E-mail", keys: ["menu_email", "enviar_email_teste", "email_configurar"] },
  { titulo: "Configurações", keys: ["config_grupos_empresas_editar", "config_minha_empresa_imagem_cor", "menu_cadastro_usuarios"] },
  { titulo: "Outros menus", keys: ["menu_acessorias", "menu_agendamentos", "menu_logs"] },
];

type PerfilTipo = {
  id: string;
  nome: string;
  created_at: string;
};

export default function PerfisPage() {
  const { hasPermissao } = useAuth();
  const podeAcessar = hasPermissao("menu_cadastro_usuarios");

  const [lista, setLista] = useState<PerfilTipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [modalAberto, setModalAberto] = useState<"novo" | PerfilTipo | null>(null);
  const [nome, setNome] = useState("");
  const [permissoesSet, setPermissoesSet] = useState<Set<string>>(new Set());
  const [gruposLista, setGruposLista] = useState<{ id: string; nome: string }[]>([]);
  const [empresasLista, setEmpresasLista] = useState<{ id: string; nome_curto: string; grupo_id: string | null }[]>([]);
  const [categoriasLista, setCategoriasLista] = useState<{ descricao: string; empresa: string }[]>([]);
  const [visibilidadeGrupos, setVisibilidadeGrupos] = useState<Set<string>>(new Set());
  const [visibilidadeEmpresas, setVisibilidadeEmpresas] = useState<Set<string>>(new Set());
  const [visibilidadeCategorias, setVisibilidadeCategorias] = useState<Set<string>>(new Set());
  const [buscaCategoria, setBuscaCategoria] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    const { data, error } = await supabase.from("perfis_tipo").select("id, nome, created_at").order("nome");
    if (error) {
      setErro(error.message);
      setLista([]);
    } else {
      setLista(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    if (podeAcessar) carregar();
    else setLoading(false);
  }, [podeAcessar]);

  async function carregarDadosVisibilidade() {
    const [resG, resE, resC] = await Promise.all([
      supabase.from("grupos").select("id, nome").order("nome"),
      supabase.from("empresas").select("id, nome_curto, grupo_id").order("nome_curto"),
      supabase.from("categorias").select("descricao, empresa").eq("conta_receita", "S").not("descricao", "is", null),
    ]);
    setGruposLista(resG.data ?? []);
    setEmpresasLista(resE.data ?? []);
    const cat = (resC.data ?? []).filter((r: { descricao: string | null }) => Boolean(r.descricao)) as { descricao: string; empresa: string }[];
    setCategoriasLista(cat);
  }

  const categoriasVisiveis = (() => {
    if (categoriasLista.length === 0) return [];
    const trim = (s: string) => (s || "").trim();
    const nenhumFiltro = visibilidadeGrupos.size === 0 && visibilidadeEmpresas.size === 0;
    if (nenhumFiltro) {
      return Array.from(new Set(categoriasLista.map((c) => trim(c.descricao)).filter(Boolean))).sort();
    }
    const nomeCurtos = new Set<string>();
    empresasLista.forEach((e) => {
      if (visibilidadeGrupos.has(e.grupo_id ?? "") || visibilidadeEmpresas.has(e.id)) nomeCurtos.add(e.nome_curto);
    });
    return Array.from(new Set(categoriasLista.filter((c) => nomeCurtos.has(c.empresa)).map((c) => trim(c.descricao)).filter(Boolean))).sort();
  })();
  const buscaCategoriaNorm = buscaCategoria.trim().toLowerCase();
  const categoriasVisiveisFiltradas = buscaCategoriaNorm ? categoriasVisiveis.filter((d) => d.toLowerCase().includes(buscaCategoriaNorm)) : categoriasVisiveis;

  async function abrirNovo() {
    setModalAberto("novo");
    setNome("");
    setPermissoesSet(new Set(DEFAULT_PERMISSOES_USUARIO));
    setVisibilidadeGrupos(new Set());
    setVisibilidadeEmpresas(new Set());
    setVisibilidadeCategorias(new Set());
    setBuscaCategoria("");
    await carregarDadosVisibilidade();
  }

  async function abrirEditar(p: PerfilTipo) {
    setModalAberto(p);
    setNome(p.nome);
    setBuscaCategoria("");
    await carregarDadosVisibilidade();
    setVisibilidadeGrupos(new Set());
    setVisibilidadeEmpresas(new Set());
    setVisibilidadeCategorias(new Set());
    const [resPerm, resG, resE, resC] = await Promise.all([
      supabase.from("perfis_tipo_permissoes").select("permissao").eq("perfis_tipo_id", p.id),
      supabase.from("perfis_tipo_grupos").select("grupo_id").eq("perfis_tipo_id", p.id),
      supabase.from("perfis_tipo_empresas").select("empresa_id").eq("perfis_tipo_id", p.id),
      supabase.from("perfis_tipo_categorias").select("categoria_descricao").eq("perfis_tipo_id", p.id),
    ]);
    const perms = (resPerm.data ?? []).map((r: { permissao: string }) => r.permissao);
    setPermissoesSet(perms.length > 0 ? new Set(perms) : new Set(DEFAULT_PERMISSOES_USUARIO));
    setVisibilidadeGrupos(new Set((resG.data ?? []).map((r: { grupo_id: string }) => r.grupo_id)));
    setVisibilidadeEmpresas(new Set((resE.data ?? []).map((r: { empresa_id: string }) => r.empresa_id)));
    setVisibilidadeCategorias(new Set((resC.data ?? []).map((r: { categoria_descricao: string }) => (r.categoria_descricao || "").trim())));
  }

  function togglePermissao(key: string) {
    setPermissoesSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleVisibilidadeGrupo(id: string) {
    setVisibilidadeGrupos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleVisibilidadeEmpresa(id: string) {
    setVisibilidadeEmpresas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleVisibilidadeCategoria(desc: string) {
    setVisibilidadeCategorias((prev) => {
      const next = new Set(prev);
      if (next.has(desc)) next.delete(desc);
      else next.add(desc);
      return next;
    });
  }

  async function salvar() {
    const nomeTrim = nome.trim();
    if (!nomeTrim) {
      setErro("Informe o nome do perfil.");
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      if (modalAberto === "novo") {
        const { data: inserted, error: errInsert } = await supabase
          .from("perfis_tipo")
          .insert({ nome: nomeTrim })
          .select("id")
          .single();
        if (errInsert) throw new Error(errInsert.message);
        const id = inserted.id;
        if (permissoesSet.size > 0) {
          await supabase.from("perfis_tipo_permissoes").insert(Array.from(permissoesSet).map((permissao) => ({ perfis_tipo_id: id, permissao })));
        }
        if (visibilidadeGrupos.size > 0) {
          await supabase.from("perfis_tipo_grupos").insert(Array.from(visibilidadeGrupos).map((grupo_id) => ({ perfis_tipo_id: id, grupo_id })));
        }
        if (visibilidadeEmpresas.size > 0) {
          await supabase.from("perfis_tipo_empresas").insert(Array.from(visibilidadeEmpresas).map((empresa_id) => ({ perfis_tipo_id: id, empresa_id })));
        }
        if (visibilidadeCategorias.size > 0) {
          const catUnicas = Array.from(new Set(Array.from(visibilidadeCategorias).map((d) => d.trim()).filter(Boolean)));
          await supabase.from("perfis_tipo_categorias").insert(catUnicas.map((categoria_descricao) => ({ perfis_tipo_id: id, categoria_descricao })));
        }
      } else if (modalAberto) {
        const id = modalAberto.id;
        await supabase.from("perfis_tipo").update({ nome: nomeTrim, updated_at: new Date().toISOString() }).eq("id", id);
        await supabase.from("perfis_tipo_permissoes").delete().eq("perfis_tipo_id", id);
        await supabase.from("perfis_tipo_grupos").delete().eq("perfis_tipo_id", id);
        await supabase.from("perfis_tipo_empresas").delete().eq("perfis_tipo_id", id);
        await supabase.from("perfis_tipo_categorias").delete().eq("perfis_tipo_id", id);
        if (permissoesSet.size > 0) {
          await supabase.from("perfis_tipo_permissoes").insert(Array.from(permissoesSet).map((permissao) => ({ perfis_tipo_id: id, permissao })));
        }
        if (visibilidadeGrupos.size > 0) {
          await supabase.from("perfis_tipo_grupos").insert(Array.from(visibilidadeGrupos).map((grupo_id) => ({ perfis_tipo_id: id, grupo_id })));
        }
        if (visibilidadeEmpresas.size > 0) {
          await supabase.from("perfis_tipo_empresas").insert(Array.from(visibilidadeEmpresas).map((empresa_id) => ({ perfis_tipo_id: id, empresa_id })));
        }
        if (visibilidadeCategorias.size > 0) {
          const catUnicas = Array.from(new Set(Array.from(visibilidadeCategorias).map((d) => d.trim()).filter(Boolean)));
          await supabase.from("perfis_tipo_categorias").insert(catUnicas.map((categoria_descricao) => ({ perfis_tipo_id: id, categoria_descricao })));
        }
      }
      setModalAberto(null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar. Tente novamente.");
      console.error(e);
    }
    setSalvando(false);
  }

  async function excluir(p: PerfilTipo) {
    if (!confirm(`Excluir o perfil "${p.nome}"? Usuários com este perfil continuarão com as permissões atuais, mas o vínculo será removido.`)) return;
    setExcluindoId(p.id);
    setErro(null);
    try {
      await supabase.from("perfis_tipo").delete().eq("id", p.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao excluir.");
      console.error(e);
    }
    setExcluindoId(null);
  }

  if (!podeAcessar) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Perfis de acesso</h1>
        <p className="text-slate-600 mt-1">Você não tem permissão para acessar esta página.</p>
      </div>
    );
  }

  if (loading) return <p className="text-slate-600">Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Perfis de acesso</h1>
      <p className="text-slate-600 mt-1">Crie perfis reutilizáveis (permissões e visualização) e atribua aos usuários no cadastro de usuários.</p>

      {erro && (
        <div className="mt-4">
          <p className="text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{erro}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          onClick={abrirNovo}
          className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700"
        >
          Novo perfil
        </button>
      </div>

      <div className="mt-4 overflow-x-auto border rounded">
        <table className="w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left p-2">Nome</th>
              <th className="text-left p-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2 font-medium">{p.nome}</td>
                <td className="p-2 flex gap-2">
                  <button type="button" onClick={() => abrirEditar(p)} className="text-slate-700 hover:underline">
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => excluir(p)}
                    disabled={excluindoId === p.id}
                    className="text-red-600 hover:underline disabled:opacity-50"
                  >
                    {excluindoId === p.id ? "Excluindo..." : "Excluir"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="text-slate-500 p-4">Nenhum perfil cadastrado. Clique em &quot;Novo perfil&quot; para criar.</p>}
      </div>

      {modalAberto && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !salvando && setModalAberto(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-semibold text-slate-800">{modalAberto === "novo" ? "Novo perfil" : "Editar perfil"}</h3>
              <button type="button" onClick={() => !salvando && setModalAberto(null)} className="text-slate-500 hover:text-slate-700 text-2xl leading-none">
                ×
              </button>
            </div>
            <div className="p-4 overflow-auto space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome do perfil</label>
                <input
                  type="text"
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  placeholder="Ex.: Vendedor, Financeiro"
                  className="w-full px-3 py-2 border rounded"
                />
              </div>
              <div>
                <p className="font-medium text-slate-800 text-sm mb-2">Permissões</p>
                <div className="space-y-3 pl-1">
                  {PERMISSOES_GRUPOS.map((grupo) => (
                    <div key={grupo.titulo}>
                      <p className="text-slate-600 text-xs mb-1">{grupo.titulo}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {grupo.keys.map((key) => (
                          <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                            <input type="checkbox" checked={permissoesSet.has(key)} onChange={() => togglePermissao(key)} className="rounded" />
                            {PERMISSOES_LABELS[key] ?? key}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-medium text-slate-800 text-sm mb-2">Visualização (grupos, empresas, categorias)</p>
                <p className="text-slate-500 text-xs mb-2">Vazio = vê todos. Preenchido = vê somente os selecionados.</p>
                <div className="space-y-2">
                  <div>
                    <span className="text-xs text-slate-600">Grupos</span>
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-auto border rounded p-2 bg-slate-50">
                      {gruposLista.map((g) => (
                        <label key={g.id} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input type="checkbox" checked={visibilidadeGrupos.has(g.id)} onChange={() => toggleVisibilidadeGrupo(g.id)} className="rounded" />
                          {g.nome}
                        </label>
                      ))}
                      {gruposLista.length === 0 && <span className="text-slate-500 text-xs">Nenhum grupo.</span>}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-600">Empresas</span>
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-auto border rounded p-2 bg-slate-50">
                      {empresasLista.map((e) => (
                        <label key={e.id} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input type="checkbox" checked={visibilidadeEmpresas.has(e.id)} onChange={() => toggleVisibilidadeEmpresa(e.id)} className="rounded" />
                          {e.nome_curto}
                        </label>
                      ))}
                      {empresasLista.length === 0 && <span className="text-slate-500 text-xs">Nenhuma empresa.</span>}
                    </div>
                  </div>
                  <div>
                    <span className="text-xs text-slate-600">Categorias</span>
                    <input
                      type="text"
                      value={buscaCategoria}
                      onChange={(e) => setBuscaCategoria(e.target.value)}
                      placeholder="Buscar..."
                      className="w-full px-2 py-1 border rounded text-sm mb-1"
                    />
                    <div className="flex flex-wrap gap-2 max-h-24 overflow-auto border rounded p-2 bg-slate-50">
                      {categoriasVisiveisFiltradas.map((desc) => (
                        <label key={desc} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input type="checkbox" checked={visibilidadeCategorias.has(desc)} onChange={() => toggleVisibilidadeCategoria(desc)} className="rounded" />
                          {desc}
                        </label>
                      ))}
                      {categoriasVisiveisFiltradas.length === 0 && <span className="text-slate-500 text-xs">Nenhuma ou selecione grupos/empresas.</span>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button type="button" onClick={() => !salvando && setModalAberto(null)} className="px-4 py-2 border rounded hover:bg-slate-100" disabled={salvando}>
                Cancelar
              </button>
              <button type="button" onClick={salvar} disabled={salvando} className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50">
                {salvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
