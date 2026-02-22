"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setLoading(true);
    const { error } = await signIn(email.trim(), password);
    setLoading(false);
    if (error) {
      setErro(error.message === "Invalid login credentials" ? "E-mail ou senha incorretos." : error.message);
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-lg p-8 border border-slate-200">
        <h1 className="text-2xl font-bold text-slate-800 text-center mb-2">Receba</h1>
        <p className="text-slate-600 text-center text-sm mb-6">Controle de Cobranças</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
              placeholder="seu@email.com"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Senha
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
              placeholder="••••••••"
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
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
