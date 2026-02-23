"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Grupo = { id: string; nome: string };
type Empresa = {
  id: string;
  grupo_id: string | null;
  razao_social: string;
  nome_curto: string;
  cnpj: string | null;
  app_key: string | null;
  app_secret_encrypted: string | null;
  app_secret?: string | null;
  ativo: boolean;
};

export default function EmpresasPage() {
  const { hasPermissao } = useAuth();
  const podeEditar = hasPermissao("config_grupos_empresas_editar");

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<Empresa | null>(null);
  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeCurto, setNomeCurto] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [grupoId, setGrupoId] = useState<string>("");
  const [appKey, setAppKey] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [mostrarSecret, setMostrarSecret] = useState(false);

  async function carregar() {
    const [resEmpresas, resGrupos] = await Promise.all([
      supabase.from("empresas").select("*, grupos(nome)").order("nome_curto"),
      supabase.from("grupos").select("id, nome").order("nome"),
    ]);
    setEmpresas(resEmpresas.data || []);
    setGrupos(resGrupos.data || []);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!razaoSocial.trim() || !nomeCurto.trim()) return;

    const payload: Record<string, unknown> = {
      razao_social: razaoSocial.trim(),
      nome_curto: nomeCurto.trim(),
      cnpj: cnpj.trim() || null,
      grupo_id: grupoId || null,
      app_key: appKey.trim() || null,
    };

    if (appSecret.trim()) {
      const res = await fetch("/api/criptografar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ valor: appSecret.trim() }),
      });
      const json = await res.json();
      if (res.ok && json.encrypted) {
        payload.app_secret_encrypted = json.encrypted;
      }
      payload.app_secret = appSecret.trim();
    } else if (editando?.app_secret_encrypted) {
      payload.app_secret_encrypted = editando.app_secret_encrypted;
      if (editando.app_secret) payload.app_secret = editando.app_secret;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    else {
      alert("Sessão não encontrada. Faça login novamente e tente salvar.");
      return;
    }

    if (editando) {
      const res = await fetch(`/api/empresas/${editando.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
      const dataRes = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = dataRes.error || `Erro ao atualizar: ${res.status}`;
        const hint = dataRes._hint;
        alert(hint ? `${msg}\n\nDica: ${hint}` : msg);
        return;
      }
      if (dataRes._debug_app_secret_saved) {
        console.log("API confirmou: app_secret gravado no banco.");
      }
      setEditando(null);
    } else {
      const res = await fetch("/api/empresas", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || `Erro ao adicionar: ${res.status}`);
        return;
      }
    }

    limparForm();
    carregar();
  }

  function limparForm() {
    setRazaoSocial("");
    setNomeCurto("");
    setCnpj("");
    setGrupoId("");
    setAppKey("");
    setAppSecret("");
    setMostrarSecret(false);
  }

  async function excluir(id: string) {
    if (!confirm("Excluir esta empresa?")) return;
    await supabase.from("empresas").delete().eq("id", id);
    carregar();
  }

  function iniciarEdicao(e: Empresa) {
    setEditando(e);
    setRazaoSocial(e.razao_social);
    setNomeCurto(e.nome_curto);
    setCnpj(e.cnpj || "");
    setGrupoId(e.grupo_id || "");
    setAppKey(e.app_key || "");
    setAppSecret("");
    setMostrarSecret(false);
  }

  function cancelarEdicao() {
    setEditando(null);
    limparForm();
  }

  if (loading) return <p>Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Empresas</h1>
      <p className="text-slate-600 mt-1">Cadastro de empresas e chaves API Omie</p>
      {!podeEditar && (
        <p className="mt-2 text-amber-700 text-sm">Somente visualização. A permissão para cadastrar/editar é definida no Cadastro de usuários.</p>
      )}

      {podeEditar && (
      <form onSubmit={salvar} className="mt-6 space-y-4 max-w-xl">
        <div>
          <label className="block text-sm font-medium mb-1">Razão Social</label>
          <input
            type="text"
            value={razaoSocial}
            onChange={(e) => setRazaoSocial(e.target.value)}
            className="w-full px-3 py-2 border rounded"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">CNPJ</label>
          <input
            type="text"
            value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            placeholder="00.000.000/0001-00 ou apenas números"
            className="w-full px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Nome Curto</label>
          <input
            type="text"
            value={nomeCurto}
            onChange={(e) => setNomeCurto(e.target.value)}
            placeholder="Ex: Alldax 1"
            className="w-full px-3 py-2 border rounded"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Grupo</label>
          <select
            value={grupoId}
            onChange={(e) => setGrupoId(e.target.value)}
            className="w-full px-3 py-2 border rounded"
          >
            <option value="">—</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">App Key (Omie)</label>
          <input
            type="text"
            value={appKey}
            onChange={(e) => setAppKey(e.target.value)}
            placeholder="Chave da aplicação"
            className="w-full px-3 py-2 border rounded"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">App Secret (Omie)</label>
          <input
            type={mostrarSecret ? "text" : "password"}
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={editando?.app_secret_encrypted ? "Deixe vazio para manter" : "Segredo"}
            className="w-full px-3 py-2 border rounded"
          />
          {editando?.app_secret_encrypted && (
            <label className="text-sm mt-1 flex items-center gap-2">
              <input type="checkbox" checked={mostrarSecret} onChange={(e) => setMostrarSecret(e.target.checked)} />
              Mostrar campo
            </label>
          )}
        </div>
        <div className="flex gap-2">
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700">
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

      <table className="mt-8 w-full border-collapse">
        <thead>
          <tr className="border-b bg-slate-100">
            <th className="text-left p-2">Razão Social</th>
            <th className="text-left p-2">CNPJ</th>
            <th className="text-left p-2">Nome Curto</th>
            <th className="text-left p-2">Grupo</th>
            <th className="text-left p-2">API</th>
            {podeEditar && <th className="text-left p-2">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {empresas.map((e) => (
            <tr key={e.id} className="border-b">
              <td className="p-2">{e.razao_social}</td>
              <td className="p-2">{e.cnpj || "—"}</td>
              <td className="p-2">{e.nome_curto}</td>
              <td className="p-2">{(e as Empresa & { grupos: { nome: string } | null }).grupos?.nome || "—"}</td>
              <td className="p-2">{e.app_key ? "Configurado" : "—"}</td>
              {podeEditar && (
                <td className="p-2 flex gap-2">
                  <button onClick={() => iniciarEdicao(e)} className="text-blue-600 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => excluir(e.id)} className="text-red-600 hover:underline">
                    Excluir
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
