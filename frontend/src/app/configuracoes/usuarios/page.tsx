"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { PERMISSOES_KEYS, DEFAULT_PERMISSOES_USUARIO } from "@/contexts/AuthContext";

const PERMISSOES_LABELS: Record<string, string> = {
  menu_cadastro_usuarios: "Cadastro de usuários",
  menu_email: "Envio de e-mail",
  enviar_email_teste: "Enviar e-mail de teste",
  menu_acessorias: "Acessórias",
  menu_agendamentos: "Agendamentos API",
  menu_logs: "Logs API",
};

type UsuarioLista = {
  id: string;
  email: string | null;
  created_at: string;
  role: string;
  ativo: boolean;
  nome: string | null;
};

export default function UsuariosPage() {
  const { profile } = useAuth();
  const podeAcessar = profile?.role === "adm" || profile?.role === "gerencia";

  const [lista, setLista] = useState<UsuarioLista[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [erroHint, setErroHint] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"usuario" | "gerencia" | "adm">("usuario");
  const [criando, setCriando] = useState(false);
  const [resetId, setResetId] = useState<string | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [visibilidadeUserId, setVisibilidadeUserId] = useState<string | null>(null);
  const [visibilidadeLoading, setVisibilidadeLoading] = useState(false);
  const [gruposLista, setGruposLista] = useState<{ id: string; nome: string }[]>([]);
  const [empresasLista, setEmpresasLista] = useState<{ id: string; nome_curto: string; grupo_id: string | null }[]>([]);
  /** Categorias com empresa (nome_curto) para filtrar por grupo/empresa selecionados */
  const [categoriasLista, setCategoriasLista] = useState<{ descricao: string; empresa: string }[]>([]);
  const [visibilidadeGrupos, setVisibilidadeGrupos] = useState<Set<string>>(new Set());
  const [visibilidadeEmpresas, setVisibilidadeEmpresas] = useState<Set<string>>(new Set());
  const [visibilidadeCategorias, setVisibilidadeCategorias] = useState<Set<string>>(new Set());
  const [visibilidadeSalvando, setVisibilidadeSalvando] = useState(false);
  const [permissoesUserId, setPermissoesUserId] = useState<string | null>(null);
  const [permissoesLoading, setPermissoesLoading] = useState(false);
  const [permissoesSet, setPermissoesSet] = useState<Set<string>>(new Set());
  const [permissoesSalvando, setPermissoesSalvando] = useState(false);

  async function carregar() {
    setErro(null);
    setErroHint(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setLista([]);
      setLoading(false);
      return;
    }
    const res = await fetch("/api/admin/usuarios", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErro(j.error || res.statusText);
      setErroHint(j.code === "MISSING_SERVICE_ROLE_KEY" ? j.hint : null);
      setLista([]);
      setLoading(false);
      return;
    }
    const data = await res.json();
    setLista(data);
    setLoading(false);
  }

  useEffect(() => {
    if (podeAcessar) carregar();
    else setLoading(false);
  }, [podeAcessar]);

  async function handleCriar(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setErro("E-mail e senha obrigatórios.");
      return;
    }
    if (password.length < 6) {
      setErro("Senha com mínimo 6 caracteres.");
      return;
    }
    setCriando(true);
    setErro(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setErro("Sessão expirada.");
      setCriando(false);
      return;
    }
    const res = await fetch("/api/admin/usuarios", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email: email.trim(), password, role }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(j.error || res.statusText);
      setErroHint(j.code === "MISSING_SERVICE_ROLE_KEY" ? j.hint : null);
      setCriando(false);
      return;
    }
    setEmail("");
    setPassword("");
    setRole("usuario");
    setErroHint(null);
    await carregar();
    setCriando(false);
  }

  async function handleResetSenha(uid: string) {
    if (!novaSenha.trim() || novaSenha.length < 6) {
      setErro("Informe uma nova senha com mínimo 6 caracteres.");
      return;
    }
    setErro(null);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setErro("Sessão expirada.");
      return;
    }
    const res = await fetch(`/api/admin/usuarios/${uid}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ password: novaSenha }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(j.error || res.statusText);
      return;
    }
    setResetId(null);
    setNovaSenha("");
  }

  async function handleInativar(uid: string) {
    if (!confirm("Inativar este usuário? Ele não poderá mais acessar o sistema.")) return;
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setErro("Sessão expirada.");
      return;
    }
    const res = await fetch(`/api/admin/usuarios/${uid}/inativar`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(j.error || res.statusText);
      return;
    }
    await carregar();
  }

  async function handleAtivar(uid: string) {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) {
      setErro("Sessão expirada.");
      return;
    }
    const res = await fetch(`/api/admin/usuarios/${uid}/ativar`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErro(j.error || res.statusText);
      return;
    }
    await carregar();
  }

  async function abrirVisibilidade(uid: string) {
    setVisibilidadeUserId(uid);
    setVisibilidadeLoading(true);
    setVisibilidadeGrupos(new Set());
    setVisibilidadeEmpresas(new Set());
    setVisibilidadeCategorias(new Set());
    try {
      const [resG, resE, resC, resPG, resPE, resPC] = await Promise.all([
        supabase.from("grupos").select("id, nome").order("nome"),
        supabase.from("empresas").select("id, nome_curto, grupo_id").order("nome_curto"),
        supabase.from("categorias").select("descricao, empresa").eq("conta_receita", "S").not("descricao", "is", null),
        supabase.from("perfis_grupos").select("grupo_id").eq("perfil_id", uid),
        supabase.from("perfis_empresas").select("empresa_id").eq("perfil_id", uid),
        supabase.from("perfis_categorias").select("categoria_descricao").eq("perfil_id", uid),
      ]);
      const grupos = resG.data || [];
      const empresas = resE.data || [];
      const categoriasComEmpresa = (resC.data || []).filter(
        (r: { descricao: string | null; empresa: string }) => Boolean(r.descricao)
      ) as { descricao: string; empresa: string }[];
      setGruposLista(grupos);
      setEmpresasLista(empresas);
      setCategoriasLista(categoriasComEmpresa);
      setVisibilidadeGrupos(new Set((resPG.data || []).map((r: { grupo_id: string }) => r.grupo_id)));
      setVisibilidadeEmpresas(new Set((resPE.data || []).map((r: { empresa_id: string }) => r.empresa_id)));
      setVisibilidadeCategorias(
        new Set((resPC.data || []).map((r: { categoria_descricao: string }) => (r.categoria_descricao || "").trim()))
      );
    } finally {
      setVisibilidadeLoading(false);
    }
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

  /** Categorias filtradas pelos grupos/empresas; deduplicadas por descrição (trim) para não repetir a mesma em várias empresas. */
  const categoriasVisiveis = (() => {
    if (categoriasLista.length === 0) return [];
    const trim = (s: string) => (s || "").trim();
    const nenhumFiltro = visibilidadeGrupos.size === 0 && visibilidadeEmpresas.size === 0;
    if (nenhumFiltro) {
      const unicas = Array.from(new Set(categoriasLista.map((c) => trim(c.descricao)).filter(Boolean)));
      return unicas.sort();
    }
    const nomeCurtos = new Set<string>();
    empresasLista.forEach((e) => {
      if (visibilidadeGrupos.has(e.grupo_id ?? "") || visibilidadeEmpresas.has(e.id)) {
        nomeCurtos.add(e.nome_curto);
      }
    });
    const descricoes = categoriasLista
      .filter((c) => nomeCurtos.has(c.empresa))
      .map((c) => trim(c.descricao))
      .filter(Boolean);
    return Array.from(new Set(descricoes)).sort();
  })();

  async function salvarVisibilidade() {
    if (!visibilidadeUserId) return;
    setVisibilidadeSalvando(true);
    setErro(null);
    try {
      await supabase.from("perfis_grupos").delete().eq("perfil_id", visibilidadeUserId);
      await supabase.from("perfis_empresas").delete().eq("perfil_id", visibilidadeUserId);
      await supabase.from("perfis_categorias").delete().eq("perfil_id", visibilidadeUserId);
      if (visibilidadeGrupos.size > 0) {
        await supabase.from("perfis_grupos").insert(
          Array.from(visibilidadeGrupos).map((grupo_id) => ({ perfil_id: visibilidadeUserId, grupo_id }))
        );
      }
      if (visibilidadeEmpresas.size > 0) {
        await supabase.from("perfis_empresas").insert(
          Array.from(visibilidadeEmpresas).map((empresa_id) => ({ perfil_id: visibilidadeUserId, empresa_id }))
        );
      }
      if (visibilidadeCategorias.size > 0) {
        const categoriasUnicas = Array.from(new Set(Array.from(visibilidadeCategorias).map((d) => d.trim()).filter(Boolean)));
        await supabase.from("perfis_categorias").insert(
          categoriasUnicas.map((categoria_descricao) => ({ perfil_id: visibilidadeUserId, categoria_descricao }))
        );
      }
      setVisibilidadeUserId(null);
    } catch (e) {
      setErro("Erro ao salvar visualização. Tente novamente.");
      console.error(e);
    }
    setVisibilidadeSalvando(false);
  }

  async function abrirPermissoes(uid: string) {
    setPermissoesUserId(uid);
    setPermissoesLoading(true);
    setPermissoesSet(new Set());
    try {
      const { data } = await supabase
        .from("perfis_permissoes")
        .select("permissao")
        .eq("perfil_id", uid);
      const list = (data ?? []).map((r: { permissao: string }) => r.permissao);
      setPermissoesSet(list.length > 0 ? new Set(list) : new Set(DEFAULT_PERMISSOES_USUARIO));
    } finally {
      setPermissoesLoading(false);
    }
  }

  function togglePermissao(key: string) {
    setPermissoesSet((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function salvarPermissoes() {
    if (!permissoesUserId) return;
    setPermissoesSalvando(true);
    setErro(null);
    try {
      await supabase.from("perfis_permissoes").delete().eq("perfil_id", permissoesUserId);
      if (permissoesSet.size > 0) {
        await supabase.from("perfis_permissoes").insert(
          Array.from(permissoesSet).map((permissao) => ({ perfil_id: permissoesUserId, permissao }))
        );
      }
      setPermissoesUserId(null);
    } catch (e) {
      setErro("Erro ao salvar permissões. Tente novamente.");
      console.error(e);
    }
    setPermissoesSalvando(false);
  }

  if (!podeAcessar) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Cadastro de usuários</h1>
        <p className="text-slate-600 mt-1">Acesso restrito a Admin e Gerência.</p>
      </div>
    );
  }

  if (loading) return <p className="text-slate-600">Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Cadastro de usuários</h1>
      <p className="text-slate-600 mt-1">Cadastrar novos usuários, resetar senha e inativar.</p>

      <form onSubmit={handleCriar} className="mt-6 p-4 border rounded bg-slate-50 max-w-xl space-y-3">
        <h2 className="font-semibold text-slate-800">Novo usuário</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              className="px-3 py-2 border rounded w-56"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Senha (mín. 6)</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={6}
              className="px-3 py-2 border rounded w-40"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Perfil</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "usuario" | "gerencia" | "adm")}
              className="px-3 py-2 border rounded"
            >
              <option value="usuario">Usuário</option>
              <option value="gerencia">Gerência</option>
              <option value="adm">Admin</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={criando}
            className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
          >
            {criando ? "Criando..." : "Cadastrar"}
          </button>
        </div>
      </form>

      {erro && (
        <div className="mt-4 space-y-2">
          <p className="text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{erro}</p>
          {erroHint && (
            <div className="bg-amber-50 border border-amber-200 text-amber-900 px-3 py-3 rounded text-sm">
              <p className="font-medium mb-1">Como corrigir:</p>
              <p className="whitespace-pre-line">{erroHint}</p>
              <p className="mt-2 text-amber-700">
                O arquivo deve ser <strong>frontend\.env.local</strong> (na pasta do projeto onde está o Next.js).
                Depois de salvar, pare o servidor (Ctrl+C) e rode <strong>npm run dev</strong> de novo.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-8">
        <h2 className="font-semibold text-slate-800 mb-3">Usuários</h2>
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left p-2">E-mail</th>
                <th className="text-left p-2">Perfil</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="p-2">{u.email ?? "—"}</td>
                  <td className="p-2 capitalize">{u.role}</td>
                  <td className="p-2">
                    <span className={u.ativo ? "text-green-700" : "text-red-700"}>
                      {u.ativo ? "Ativo" : "Inativo"}
                    </span>
                  </td>
                  <td className="p-2 flex flex-wrap gap-2">
                    {resetId === u.id ? (
                      <>
                        <input
                          type="password"
                          value={novaSenha}
                          onChange={(e) => setNovaSenha(e.target.value)}
                          placeholder="Nova senha"
                          minLength={6}
                          className="px-2 py-1 border rounded w-32 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => handleResetSenha(u.id)}
                          className="text-blue-600 text-sm hover:underline"
                        >
                          Ok
                        </button>
                        <button
                          type="button"
                          onClick={() => { setResetId(null); setNovaSenha(""); }}
                          className="text-slate-600 text-sm hover:underline"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => abrirVisibilidade(u.id)}
                          className="text-slate-700 hover:underline"
                        >
                          Visualização
                        </button>
                        <button
                          type="button"
                          onClick={() => abrirPermissoes(u.id)}
                          className="text-slate-700 hover:underline"
                        >
                          Permissões
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetId(u.id)}
                          className="text-blue-600 hover:underline"
                        >
                          Resetar senha
                        </button>
                        {u.ativo ? (
                          <button
                            type="button"
                            onClick={() => handleInativar(u.id)}
                            className="text-red-600 hover:underline"
                          >
                            Inativar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleAtivar(u.id)}
                            className="text-green-600 hover:underline"
                          >
                            Ativar
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lista.length === 0 && <p className="text-slate-500 py-4">Nenhum usuário listado.</p>}
      </div>

      {permissoesUserId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !permissoesSalvando && setPermissoesUserId(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-md w-full overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-semibold text-slate-800">Permissões</h3>
              <button
                type="button"
                onClick={() => !permissoesSalvando && setPermissoesUserId(null)}
                className="text-slate-500 hover:text-slate-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-auto">
              <p className="text-slate-600 text-sm mb-4">
                Marque os menus e ações permitidos para este usuário. Admin e Gerência têm todas as permissões.
              </p>
              {permissoesLoading ? (
                <p className="text-slate-600">Carregando...</p>
              ) : (
                <div className="space-y-2">
                  {PERMISSOES_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={permissoesSet.has(key)}
                        onChange={() => togglePermissao(key)}
                        className="rounded"
                      />
                      {PERMISSOES_LABELS[key] ?? key}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPermissoesUserId(null)}
                className="px-4 py-2 border rounded hover:bg-slate-100"
                disabled={permissoesSalvando}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarPermissoes}
                disabled={permissoesLoading || permissoesSalvando}
                className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {permissoesSalvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {visibilidadeUserId && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => !visibilidadeSalvando && setVisibilidadeUserId(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-semibold text-slate-800">Visualização no dashboard</h3>
              <button
                type="button"
                onClick={() => !visibilidadeSalvando && setVisibilidadeUserId(null)}
                className="text-slate-500 hover:text-slate-700 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-auto space-y-4">
              <p className="text-slate-600 text-sm">
                Se não marcar nenhum grupo/empresa/categoria, o usuário vê todos. Se marcar, vê somente os selecionados.
              </p>
              {visibilidadeLoading ? (
                <p className="text-slate-600">Carregando...</p>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Grupos</label>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-auto border rounded p-2 bg-slate-50">
                      {gruposLista.map((g) => (
                        <label key={g.id} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={visibilidadeGrupos.has(g.id)}
                            onChange={() => toggleVisibilidadeGrupo(g.id)}
                            className="rounded"
                          />
                          {g.nome}
                        </label>
                      ))}
                      {gruposLista.length === 0 && <span className="text-slate-500 text-sm">Nenhum grupo cadastrado.</span>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Empresas</label>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-auto border rounded p-2 bg-slate-50">
                      {empresasLista.map((e) => (
                        <label key={e.id} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={visibilidadeEmpresas.has(e.id)}
                            onChange={() => toggleVisibilidadeEmpresa(e.id)}
                            className="rounded"
                          />
                          {e.nome_curto}
                        </label>
                      ))}
                      {empresasLista.length === 0 && <span className="text-slate-500 text-sm">Nenhuma empresa cadastrada.</span>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">Categorias</label>
                    <p className="text-slate-500 text-xs mb-1">
                      {visibilidadeGrupos.size > 0 || visibilidadeEmpresas.size > 0
                        ? "Exibindo apenas categorias das empresas/grupos selecionados acima."
                        : "Selecione grupos ou empresas acima para filtrar as categorias listadas."}
                    </p>
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-auto border rounded p-2 bg-slate-50">
                      {categoriasVisiveis.map((desc) => (
                        <label key={desc} className="inline-flex items-center gap-1.5 cursor-pointer text-sm">
                          <input
                            type="checkbox"
                            checked={visibilidadeCategorias.has(desc)}
                            onChange={() => toggleVisibilidadeCategoria(desc)}
                            className="rounded"
                          />
                          {desc}
                        </label>
                      ))}
                      {categoriasVisiveis.length === 0 && (
                        <span className="text-slate-500 text-sm">
                          {visibilidadeGrupos.size > 0 || visibilidadeEmpresas.size > 0
                            ? "Nenhuma categoria nas empresas/grupos selecionados."
                            : "Nenhuma categoria (conta_receita=S)."}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="p-4 border-t flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setVisibilidadeUserId(null)}
                className="px-4 py-2 border rounded hover:bg-slate-100"
                disabled={visibilidadeSalvando}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={salvarVisibilidade}
                disabled={visibilidadeLoading || visibilidadeSalvando}
                className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
              >
                {visibilidadeSalvando ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
