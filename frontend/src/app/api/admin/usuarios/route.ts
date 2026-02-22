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
  const { data: perfis } = await supabase.from("perfis").select("id, role, ativo, nome").in("id", ids);
  const map = new Map((perfis || []).map((p) => [p.id, p]));
  const list = users.users.map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    role: map.get(u.id)?.role ?? "usuario",
    ativo: map.get(u.id)?.ativo !== false,
    nome: map.get(u.id)?.nome ?? null,
  }));
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
  const { email, password, role } = body as { email?: string; password?: string; role?: string };
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
  await supabase.from("perfis").insert({
    id: newUser.user.id,
    role: roleVal,
    primeiro_login: true,
    ativo: true,
  });
  return NextResponse.json({ id: newUser.user.id, email: newUser.user.email });
}
