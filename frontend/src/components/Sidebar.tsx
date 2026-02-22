"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

const pathInEmpresasInternas = (path: string) =>
  path === "/configuracoes/grupos" || path === "/configuracoes/empresas";
const pathInApi = (path: string) =>
  path === "/configuracoes/agendamentos" || path === "/configuracoes/logs";
const pathConcimed = (path: string) =>
  path === "/concimed/pagamentos-medicos" || (path ?? "").startsWith("/concimed/");
const pathDividendos = (path: string) =>
  (path ?? "").startsWith("/dividendos-2025/");
const pathMinhaEmpresa = (path: string) => path === "/configuracoes/minha-empresa";
const pathMeuUsuario = (path: string) => path === "/configuracoes/meu-usuario";
const pathUsuarios = (path: string) => path === "/configuracoes/usuarios";
const pathEmail = (path: string) => path === "/configuracoes/email";

type SidebarProps = { open: boolean; onToggle: () => void };

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, signOut, hasPermissao } = useAuth();

  const [configuracoesAberto, setConfiguracoesAberto] = useState(false);
  const [concimedAberto, setConcimedAberto] = useState(false);
  const [empresasInternasAberto, setEmpresasInternasAberto] = useState(false);
  const [apiAberto, setApiAberto] = useState(false);

  useEffect(() => {
    if (pathConcimed(pathname ?? "")) {
      setConcimedAberto(true);
    }
    if (pathDividendos(pathname ?? "")) {
      setConcimedAberto(true);
    }
    if (
      pathInEmpresasInternas(pathname ?? "") ||
      pathname === "/acessorias" ||
      pathMinhaEmpresa(pathname ?? "") ||
      pathMeuUsuario(pathname ?? "") ||
      pathUsuarios(pathname ?? "") ||
      pathEmail(pathname ?? "") ||
      pathInApi(pathname ?? "")
    ) {
      setConfiguracoesAberto(true);
    }
    if (pathInEmpresasInternas(pathname ?? "")) {
      setEmpresasInternasAberto(true);
    }
    if (pathInApi(pathname ?? "")) {
      setApiAberto(true);
    }
  }, [pathname]);

  async function handleLogout() {
    await signOut();
    router.replace("/login");
    router.refresh();
  }

  function isActive(href: string) {
    return pathname === href;
  }

  if (!open) {
    return (
      <aside className="fixed left-0 top-0 bottom-0 z-30 w-10 bg-slate-800 text-white flex flex-col items-center py-4">
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded hover:bg-slate-700 text-slate-300 text-lg font-bold"
          title="Exibir menu"
        >
          »
        </button>
      </aside>
    );
  }

  return (
    <aside className="fixed left-0 top-0 bottom-0 z-30 w-56 bg-slate-800 text-white p-4 flex flex-col transition-[width] duration-200">
      <div className="flex items-center justify-between gap-2 mb-6 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo.png" alt="Recebx" className="h-8 w-auto object-contain shrink-0" />
          <h1 className="text-xl font-bold truncate">Recebx</h1>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white text-sm"
          title="Ocultar menu"
        >
          «
        </button>
      </div>
      <nav className="flex-1 min-h-0 overflow-y-auto">
        <ul className="space-y-1">
          <li>
            <Link
              href="/dashboard"
              className={`block px-3 py-2 rounded ${
                pathname === "/dashboard" ? "bg-slate-600" : "hover:bg-slate-700"
              }`}
            >
              Dashboard
            </Link>
          </li>
        </ul>

        <div className="mt-6">
          <button
            type="button"
            onClick={() => setConcimedAberto((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 rounded hover:bg-slate-700 text-left text-slate-300"
          >
            <span className="text-slate-400 text-xs uppercase">Concimed</span>
            <span className="text-slate-500">{concimedAberto ? "▼" : "▶"}</span>
          </button>
          {concimedAberto && (
            <ul className="pl-2 mt-1 space-y-0.5">
              <li>
                <Link
                  href="/concimed/pagamentos-medicos"
                  className={`block px-3 py-2 rounded text-sm ${
                    isActive("/concimed/pagamentos-medicos") ? "bg-slate-600" : "hover:bg-slate-700"
                  }`}
                >
                  Pagamentos para medicos
                </Link>
              </li>
              <li>
                <Link
                  href="/dividendos-2025/controle"
                  className={`block px-3 py-2 rounded text-sm ${
                    isActive("/dividendos-2025/controle") ? "bg-slate-600" : "hover:bg-slate-700"
                  }`}
                >
                  Controle Dividendos ata 2025
                </Link>
              </li>
            </ul>
          )}

          <button
            type="button"
            onClick={() => setConfiguracoesAberto((v) => !v)}
            className="flex items-center justify-between w-full px-3 py-2 rounded hover:bg-slate-700 text-left text-slate-300"
          >
            <span className="text-slate-400 text-xs uppercase">Configurações</span>
            <span className="text-slate-500">{configuracoesAberto ? "▼" : "▶"}</span>
          </button>

          {configuracoesAberto && (
            <div className="pl-2 mt-1 space-y-1">
              <div>
                <button
                  type="button"
                  onClick={() => setEmpresasInternasAberto((v) => !v)}
                  className="flex items-center justify-between w-full px-3 py-2 rounded hover:bg-slate-700 text-left text-sm"
                >
                  <span>Empresas Internas</span>
                  <span className="text-slate-500 text-xs">{empresasInternasAberto ? "▼" : "▶"}</span>
                </button>
                {empresasInternasAberto && (
                  <ul className="pl-4 mt-1 space-y-0.5">
                    <li>
                      <Link
                        href="/configuracoes/grupos"
                        className={`block px-3 py-2 rounded text-sm ${
                          isActive("/configuracoes/grupos") ? "bg-slate-600" : "hover:bg-slate-700"
                        }`}
                      >
                        Grupos
                      </Link>
                    </li>
                    <li>
                      <Link
                        href="/configuracoes/empresas"
                        className={`block px-3 py-2 rounded text-sm ${
                          isActive("/configuracoes/empresas") ? "bg-slate-600" : "hover:bg-slate-700"
                        }`}
                      >
                        Empresas
                      </Link>
                    </li>
                  </ul>
                )}
              </div>

              <div>
                <Link
                  href="/configuracoes/minha-empresa"
                  className={`block px-3 py-2 rounded text-sm ${
                    isActive("/configuracoes/minha-empresa") ? "bg-slate-600" : "hover:bg-slate-700"
                  }`}
                >
                  Minha empresa
                </Link>
              </div>

              <div>
                <Link
                  href="/configuracoes/meu-usuario"
                  className={`block px-3 py-2 rounded text-sm ${
                    isActive("/configuracoes/meu-usuario") ? "bg-slate-600" : "hover:bg-slate-700"
                  }`}
                >
                  Usuário
                </Link>
              </div>

              {hasPermissao("menu_cadastro_usuarios") && (
                <div>
                  <Link
                    href="/configuracoes/usuarios"
                    className={`block px-3 py-2 rounded text-sm ${
                      isActive("/configuracoes/usuarios") ? "bg-slate-600" : "hover:bg-slate-700"
                    }`}
                  >
                    Cadastro usuário
                  </Link>
                </div>
              )}

              {hasPermissao("menu_email") && (
                <div>
                  <Link
                    href="/configuracoes/email"
                    className={`block px-3 py-2 rounded text-sm ${
                      isActive("/configuracoes/email") ? "bg-slate-600" : "hover:bg-slate-700"
                    }`}
                  >
                    Envio de e-mail
                  </Link>
                </div>
              )}

              {hasPermissao("menu_acessorias") && (
                <div>
                  <Link
                    href="/acessorias"
                    className={`block px-3 py-2 rounded text-sm ${
                      isActive("/acessorias") ? "bg-slate-600" : "hover:bg-slate-700"
                    }`}
                  >
                    Acessórias
                  </Link>
                </div>
              )}

              {(hasPermissao("menu_agendamentos") || hasPermissao("menu_logs")) && (
                <div>
                  <button
                    type="button"
                    onClick={() => setApiAberto((v) => !v)}
                    className="flex items-center justify-between w-full px-3 py-2 rounded hover:bg-slate-700 text-left text-sm"
                  >
                    <span>API</span>
                    <span className="text-slate-500 text-xs">{apiAberto ? "▼" : "▶"}</span>
                  </button>
                  {apiAberto && (
                    <ul className="pl-4 mt-1 space-y-0.5">
                      {hasPermissao("menu_agendamentos") && (
                        <li>
                          <Link
                            href="/configuracoes/agendamentos"
                            className={`block px-3 py-2 rounded text-sm ${
                              isActive("/configuracoes/agendamentos") ? "bg-slate-600" : "hover:bg-slate-700"
                            }`}
                          >
                            Agendamentos API
                          </Link>
                        </li>
                      )}
                      {hasPermissao("menu_logs") && (
                        <li>
                          <Link
                            href="/configuracoes/logs"
                            className={`block px-3 py-2 rounded text-sm ${
                              isActive("/configuracoes/logs") ? "bg-slate-600" : "hover:bg-slate-700"
                            }`}
                          >
                            Logs API
                          </Link>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
      <div className="mt-auto pt-4 border-t border-slate-600 shrink-0 bg-slate-800">
        <p className="text-slate-300 text-xs truncate mb-1" title={user?.email ?? ""}>
          {user?.email ?? "—"}
        </p>
        <p className="text-slate-500 text-xs mb-2 capitalize">{profile?.role ?? "—"}</p>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full text-left px-3 py-2 text-sm rounded hover:bg-slate-700 text-slate-300"
        >
          Sair
        </button>
      </div>
    </aside>
  );
}
