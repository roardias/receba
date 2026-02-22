import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function checkAdmin(request: NextRequest) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data: perfil } = await client.from("perfis").select("role").eq("id", user.id).single();
  if (perfil?.role !== "adm" && perfil?.role !== "gerencia") return null;
  return { user, perfil };
}

export async function GET(request: NextRequest) {
  const admin = await checkAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error: "Serviço não configurado",
        code: "MISSING_SERVICE_ROLE_KEY",
        hint: "Adicione SUPABASE_SERVICE_ROLE_KEY no arquivo .env.local (pasta frontend). Chave em: Supabase Dashboard > Project Settings > API > service_role. Depois reinicie o servidor (npm run dev).",
      },
      { status: 500 }
    );
  }
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRoleKey);
  const { data: users, error: errUsers } = await supabase.auth.admin.listUsers();
  if (errUsers) {
    return NextResponse.json({ error: errUsers.message }, { status: 500 });
  }
  const ids = users.users.map((u) => u.id);
  const { data: perfis } = await supabase.from("perfis").select("id, role, ativo, nome, perfis_tipo_id").in("id", ids);
  const map = new Map((perfis || []).map((p) => [p.id, p]));
  const tipoIds = Array.from(new Set((perfis || []).map((p) => p.perfis_tipo_id).filter(Boolean))) as string[];
  const tipoMap = new Map<string, string>();
  if (tipoIds.length > 0) {
    const { data: tipos } = await supabase.from("perfis_tipo").select("id, nome").in("id", tipoIds);
    (tipos || []).forEach((t: { id: string; nome: string }) => tipoMap.set(t.id, t.nome));
  }
  const list = users.users.map((u) => {
    const p = map.get(u.id);
    const perfis_tipo_id = p?.perfis_tipo_id ?? null;
    return {
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      role: p?.role ?? "usuario",
      ativo: p?.ativo !== false,
      nome: p?.nome ?? null,
      perfis_tipo_id,
      perfis_tipo_nome: perfis_tipo_id ? tipoMap.get(perfis_tipo_id) ?? null : null,
    };
  });
  return NextResponse.json(list);
}

export async function POST(request: NextRequest) {
  const admin = await checkAdmin(request);
  if (!admin) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  if (!serviceRoleKey) {
    return NextResponse.json(
      {
        error: "Serviço não configurado",
        code: "MISSING_SERVICE_ROLE_KEY",
        hint: "Adicione SUPABASE_SERVICE_ROLE_KEY no arquivo .env.local (pasta frontend). Chave em: Supabase Dashboard > Project Settings > API > service_role. Depois reinicie o servidor (npm run dev).",
      },
      { status: 500 }
    );
  }
  const body = await request.json();
  const { email, password, role, perfis_tipo_id } = body as { email?: string; password?: string; role?: string; perfis_tipo_id?: string | null };
  if (!email || !password) {
    return NextResponse.json({ error: "email e password obrigatórios" }, { status: 400 });
  }
  const roleVal = role === "adm" || role === "gerencia" ? role : "usuario";
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceRoleKey);
  const { data: newUser, error: errCreate } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (errCreate) {
    return NextResponse.json({ error: errCreate.message }, { status: 400 });
  }
  const userId = newUser.user.id;
  await supabase.from("perfis").insert({
    id: userId,
    role: roleVal,
    primeiro_login: true,
    ativo: true,
    perfis_tipo_id: perfis_tipo_id || null,
  });
  if (perfis_tipo_id) {
    const [perm, gr, em, cat] = await Promise.all([
      supabase.from("perfis_tipo_permissoes").select("permissao").eq("perfis_tipo_id", perfis_tipo_id),
      supabase.from("perfis_tipo_grupos").select("grupo_id").eq("perfis_tipo_id", perfis_tipo_id),
      supabase.from("perfis_tipo_empresas").select("empresa_id").eq("perfis_tipo_id", perfis_tipo_id),
      supabase.from("perfis_tipo_categorias").select("categoria_descricao").eq("perfis_tipo_id", perfis_tipo_id),
    ]);
    if ((perm.data ?? []).length > 0) {
      await supabase.from("perfis_permissoes").insert(perm.data!.map((r: { permissao: string }) => ({ perfil_id: userId, permissao: r.permissao })));
    }
    if ((gr.data ?? []).length > 0) {
      await supabase.from("perfis_grupos").insert(gr.data!.map((r: { grupo_id: string }) => ({ perfil_id: userId, grupo_id: r.grupo_id })));
    }
    if ((em.data ?? []).length > 0) {
      await supabase.from("perfis_empresas").insert(em.data!.map((r: { empresa_id: string }) => ({ perfil_id: userId, empresa_id: r.empresa_id })));
    }
    if ((cat.data ?? []).length > 0) {
      await supabase.from("perfis_categorias").insert(cat.data!.map((r: { categoria_descricao: string }) => ({ perfil_id: userId, categoria_descricao: r.categoria_descricao })));
    }
  }
  return NextResponse.json({ id: userId, email: newUser.user.email });
}
