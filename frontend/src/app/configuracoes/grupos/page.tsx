"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

type Grupo = { id: string; nome: string; ordem: number };

export default function GruposPage() {
  const { hasPermissao } = useAuth();
  const podeEditar = hasPermissao("config_grupos_empresas_editar");

  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState<Grupo | null>(null);
  const [nome, setNome] = useState("");

  async function carregar() {
    const { data } = await supabase.from("grupos").select("*").order("ordem");
    setGrupos(data || []);
    setLoading(false);
  }

  useEffect(() => {
    carregar();
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;

    if (editando) {
      await supabase.from("grupos").update({ nome: nome.trim() }).eq("id", editando.id);
      setEditando(null);
    } else {
      await supabase.from("grupos").insert({ nome: nome.trim() });
    }
    setNome("");
    carregar();
  }

  async function excluir(id: string) {
    if (!confirm("Excluir este grupo?")) return;
    await supabase.from("grupos").delete().eq("id", id);
    carregar();
  }

  function iniciarEdicao(g: Grupo) {
    setEditando(g);
    setNome(g.nome);
  }

  function cancelarEdicao() {
    setEditando(null);
    setNome("");
  }

  if (loading) return <p>Carregando...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Grupos</h1>
      <p className="text-slate-600 mt-1">Agrupe empresas (ex: Alldax 1, 2, 3 no grupo Alldax)</p>
      {!podeEditar && (
        <p className="mt-2 text-amber-700 text-sm">Somente visualização. Permissão para cadastrar/editar é definida no Cadastro de usuários.</p>
      )}

      {podeEditar && (
        <form onSubmit={salvar} className="mt-6 flex gap-2">
          <input
            type="text"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do grupo"
            className="px-3 py-2 border rounded w-64"
          />
          <button type="submit" className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700">
            {editando ? "Atualizar" : "Adicionar"}
          </button>
          {editando && (
            <button type="button" onClick={cancelarEdicao} className="px-4 py-2 border rounded">
              Cancelar
            </button>
          )}
        </form>
      )}

      <table className="mt-6 w-full border-collapse">
        <thead>
          <tr className="border-b bg-slate-100">
            <th className="text-left p-2">Nome</th>
            {podeEditar && <th className="text-left p-2">Ações</th>}
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.id} className="border-b">
              <td className="p-2">{g.nome}</td>
              {podeEditar && (
                <td className="p-2 flex gap-2">
                  <button onClick={() => iniciarEdicao(g)} className="text-blue-600 hover:underline">
                    Editar
                  </button>
                  <button onClick={() => excluir(g.id)} className="text-red-600 hover:underline">
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
