"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";

export default function AlterarSenhaPage() {
  const router = useRouter();
  const { profile, loading: authLoading, setPrimeiroLoginFalse } = useAuth();
  const [senha, setSenha] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (profile && !profile.primeiro_login) router.replace("/");
  }, [authLoading, profile, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (senha.length < 6) {
      setErro("A senha deve ter no mínimo 6 caracteres.");
      return;
    }
    if (senha !== confirmar) {
      setErro("As senhas não coincidem.");
      return;
    }
    setLoading(true);
    try {
      // Atualizar primeiro o perfil (primeiro_login = false) para evitar que o onAuthStateChange
      // disparado pela troca de senha sobrescreva o estado com perfil antigo e force nova tela de alteração.
      const { error: errPerfil } = await setPrimeiroLoginFalse();
      if (errPerfil) {
        setErro(errPerfil.message || "Erro ao atualizar perfil. Tente fazer logout e login novamente.");
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) {
        setErro(error.message);
        return;
      }
      router.push("/");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setLoading(false);
    }
  }

  if (authLoading || (profile && !profile.primeiro_login)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <p className="text-slate-600">Carregando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-lg p-8 border border-slate-200">
        <h1 className="text-xl font-bold text-slate-800 text-center mb-2">Alteração de senha obrigatória</h1>
        <p className="text-slate-600 text-center text-sm mb-6">
          Este é seu primeiro acesso. Por segurança, defina uma nova senha.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="senha" className="block text-sm font-medium text-slate-700 mb-1">
              Nova senha
            </label>
            <input
              id="senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
              placeholder="Mínimo 6 caracteres"
            />
          </div>
          <div>
            <label htmlFor="confirmar" className="block text-sm font-medium text-slate-700 mb-1">
              Confirmar nova senha
            </label>
            <input
              id="confirmar"
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
              placeholder="Repita a senha"
            />
          </div>
          {erro && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{erro}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-slate-800 text-white font-medium rounded-lg hover:bg-slate-700 disabled:opacity-50"
          >
            {loading ? "Salvando..." : "Alterar senha e continuar"}
          </button>
        </form>
      </div>
    </div>
  );
}
