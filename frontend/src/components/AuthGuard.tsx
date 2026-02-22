"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import Sidebar from "./Sidebar";

const ROTAS_PUBLICAS = ["/login", "/alterar-senha"];
const TIMEOUT_SESSAO_INVALIDA_MS = 5000;

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, profile, loading, signOut } = useAuth();
  const rotaPublica = ROTAS_PUBLICAS.some((r) => pathname?.startsWith(r));
  const [sessaoInvalida, setSessaoInvalida] = useState(false);
  const [sidebarAberta, setSidebarAberta] = useState(true);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const carregandoPerfil = session && profile === null && !rotaPublica;
  const usuarioInativo = session && profile && profile.ativo === false;
  const deveIrParaAlterarSenha =
    session && profile?.primeiro_login && pathname !== "/alterar-senha";

  useEffect(() => {
    if (loading) return;
    if (!session && !rotaPublica) {
      router.replace("/login");
      return;
    }
    if (usuarioInativo) {
      signOut().then(() => {
        router.replace("/login");
        router.refresh();
      });
      return;
    }
    if (deveIrParaAlterarSenha) {
      router.replace("/alterar-senha");
    }
  }, [loading, session, profile?.primeiro_login, profile?.ativo, pathname, rotaPublica, router, deveIrParaAlterarSenha, usuarioInativo, signOut]);

  useEffect(() => {
    if (!session || profile !== null || rotaPublica) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setSessaoInvalida(false);
      return;
    }
    timeoutRef.current = setTimeout(() => {
      setSessaoInvalida(true);
      signOut().then(() => {
        router.replace("/login");
        router.refresh();
      });
    }, TIMEOUT_SESSAO_INVALIDA_MS);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [session, profile, rotaPublica, signOut, router]);

  if (sessaoInvalida) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Sessão inválida ou usuário removido. Redirecionando para login...</p>
      </div>
    );
  }

  if (usuarioInativo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Conta inativa. Redirecionando para login...</p>
      </div>
    );
  }

  if (loading || carregandoPerfil) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Carregando...</p>
      </div>
    );
  }

  if (rotaPublica) {
    return <>{children}</>;
  }

  if (deveIrParaAlterarSenha) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Redirecionando...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Sidebar
        open={sidebarAberta}
        onToggle={() => setSidebarAberta((v) => !v)}
      />
      <main
        className={`min-h-screen p-6 transition-[margin] duration-200 ${
          sidebarAberta ? "ml-56" : "ml-10"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
