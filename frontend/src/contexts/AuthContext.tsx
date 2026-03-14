"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";

export type Role = "adm" | "gerencia" | "usuario";

/** Chaves de permissão: menu_* = ver no menu; dashboard_* = ações no popup; config_* = configurações; etc. */
export const PERMISSOES_KEYS = [
  "menu_historico_cobrancas",
  "historico_cobrancas_editar",
  "dashboard_enviar_email",
  "dashboard_registrar_ligacao",
  "dashboard_registrar_whatsapp",
  "menu_cadastro_usuarios",
  "menu_email",
  "enviar_email_teste",
  "email_configurar",
  "menu_acessorias",
  "menu_basal",
  "menu_agendamentos",
  "menu_logs",
  "config_grupos_empresas_editar",
  "config_minha_empresa_imagem_cor",
] as const;

/** Padrão para role usuario quando não há nenhuma linha em perfis_permissoes */
export const DEFAULT_PERMISSOES_USUARIO: string[] = [
  "menu_historico_cobrancas",
  "historico_cobrancas_editar",
  "dashboard_enviar_email",
  "dashboard_registrar_ligacao",
  "dashboard_registrar_whatsapp",
  "menu_email",
  "enviar_email_teste",
  "menu_acessorias",
  "menu_agendamentos",
  "menu_logs",
];

export type Perfil = {
  id: string;
  role: Role;
  primeiro_login: boolean;
  ativo?: boolean;
  nome: string | null;
  created_at: string;
  updated_at: string;
  /** Preenchido após carregar perfis_permissoes; vazio = usar DEFAULT_PERMISSOES_USUARIO para usuario */
  permissoes?: string[];
};

type AuthContextType = {
  user: User | null;
  session: Session | null;
  profile: Perfil | null;
  loading: boolean;
  /** Retorna true para adm/gerencia; para usuario, conforme permissoes (ou padrão se vazio) */
  hasPermissao: (permissao: string) => boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  setPrimeiroLoginFalse: () => Promise<{ error: Error | null }>;
};

const AuthContext = createContext<AuthContextType | null>(null);

const PERFIL_TIMEOUT_MS = 8000;

async function ensurePerfil(userId: string): Promise<Perfil | null> {
  const fetchPerfil = async (): Promise<Perfil | null> => {
    const { data: existing } = await supabase
      .from("perfis")
      .select("*")
      .eq("id", userId)
      .single();

    const perfil = (existing ?? null) as Perfil | null;
    if (!perfil) {
      const { data: inserted, error } = await supabase
        .from("perfis")
        .insert({
          id: userId,
          role: "usuario",
          primeiro_login: true,
          ativo: true,
        })
        .select()
        .single();

      if (error) {
        console.error("Erro ao criar perfil:", error);
        return null;
      }
      const p = inserted as Perfil;
      const { data: permData } = await supabase
        .from("perfis_permissoes")
        .select("permissao")
        .eq("perfil_id", userId);
      return { ...p, permissoes: (permData ?? []).map((r: { permissao: string }) => r.permissao) };
    }

    const { data: permData } = await supabase
      .from("perfis_permissoes")
      .select("permissao")
      .eq("perfil_id", userId);
    return {
      ...perfil,
      permissoes: (permData ?? []).map((r: { permissao: string }) => r.permissao),
    };
  };

  const timeout = new Promise<null>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), PERFIL_TIMEOUT_MS)
  );
  try {
    return await Promise.race([fetchPerfil(), timeout]);
  } catch {
    console.warn("Perfil: timeout ou erro. Tente recarregar.");
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Perfil | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!session?.user?.id) {
      setProfile(null);
      return;
    }
    const p = await ensurePerfil(session.user.id);
    setProfile((prev) => {
      if (prev?.primeiro_login === false && p?.primeiro_login === true) return { ...p, primeiro_login: false };
      return p;
    });
  }, [session?.user?.id]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
      if (s?.user?.id) {
        ensurePerfil(s.user.id).then(async (p) => {
          if (p === null || p.ativo === false) {
            setProfile(null);
            await supabase.auth.signOut();
            return;
          }
          setProfile((prev) => {
            if (prev?.primeiro_login === false && p.primeiro_login === true) return { ...p, primeiro_login: false };
            return p;
          });
        });
      } else {
        setProfile(null);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user?.id) {
        ensurePerfil(s.user.id).then(async (p) => {
          if (p === null || p.ativo === false) {
            setProfile(null);
            await supabase.auth.signOut();
            return;
          }
          setProfile((prev) => {
            if (prev?.primeiro_login === false && p.primeiro_login === true) return { ...p, primeiro_login: false };
            return p;
          });
        });
      } else {
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ?? null };
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const setPrimeiroLoginFalse = useCallback(async (): Promise<{ error: Error | null }> => {
    if (!user?.id) return { error: new Error("Usuário não identificado") };
    const { error } = await supabase
      .from("perfis")
      .update({ primeiro_login: false, updated_at: new Date().toISOString() })
      .eq("id", user.id);
    if (error) return { error: new Error(error.message) };
    setProfile((prev) => (prev ? { ...prev, primeiro_login: false } : null));
    return { error: null };
  }, [user?.id]);

  const hasPermissao = useCallback(
    (permissao: string) => {
      if (!profile) return false;
      if (profile.role === "adm" || profile.role === "gerencia") return true;
      const list =
        profile.permissoes && profile.permissoes.length > 0
          ? profile.permissoes
          : DEFAULT_PERMISSOES_USUARIO;
      return list.includes(permissao);
    },
    [profile]
  );

  const value: AuthContextType = {
    user,
    session,
    profile,
    loading,
    hasPermissao,
    signIn,
    signOut,
    refreshProfile,
    setPrimeiroLoginFalse,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
