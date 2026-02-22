"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export default function MeuUsuarioPage() {
  const { user } = useAuth();
  const [senhaAtual, setSenhaAtual] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSucesso(false);
    if (novaSenha.length < 6) {
      setErro("A nova senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (novaSenha !== confirmar) {
      setErro("A nova senha e a confirmação não coincidem.");
      return;
    }
    setLoading(true);
    const { error: errSignIn } = await supabase.auth.signInWithPassword({
      email: user?.email ?? "",
      password: senhaAtual,
    });
    if (errSignIn) {
      setErro("Senha atual incorreta.");
      setLoading(false);
      return;
    }
    const { error: errUpdate } = await supabase.auth.updateUser({ password: novaSenha });
    if (errUpdate) {
      setErro(errUpdate.message);
      setLoading(false);
      return;
    }
    setSenhaAtual("");
    setNovaSenha("");
    setConfirmar("");
    setSucesso(true);
    setLoading(false);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800">Usuário</h1>
      <p className="text-slate-600 mt-1">Altere sua senha de acesso.</p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Senha atual
          </label>
          <input
            type="password"
            value={senhaAtual}
            onChange={(e) => setSenhaAtual(e.target.value)}
            required
            className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-slate-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Nova senha
          </label>
          <input
            type="password"
            value={novaSenha}
            onChange={(e) => setNovaSenha(e.target.value)}
            required
            minLength={6}
            className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-slate-500"
            placeholder="Mínimo 6 caracteres"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Confirmar nova senha
          </label>
          <input
            type="password"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            required
            minLength={6}
            className="w-full px-3 py-2 border border-slate-300 rounded focus:ring-2 focus:ring-slate-500"
          />
        </div>
        {erro && (
          <p className="text-red-600 bg-red-50 px-3 py-2 rounded text-sm">{erro}</p>
        )}
        {sucesso && (
          <p className="text-green-700 bg-green-50 px-3 py-2 rounded text-sm">
            Senha alterada com sucesso.
          </p>
        )}
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-slate-800 text-white rounded hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Alterando..." : "Alterar senha"}
        </button>
      </form>
    </div>
  );
}
