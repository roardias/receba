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
  return true;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ok = await checkAdmin(request);
  if (!ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  if (!serviceRoleKey) {
    return NextResponse.json({ error: "Serviço não configurado" }, { status: 500 });
  }
  const { id } = await params;
  const body = await request.json();
  const { password } = body as { password?: string };
  if (!password || password.length < 6) {
    return NextResponse.json({ error: "Senha obrigatória (mín. 6 caracteres)" }, { status: 400 });
  }
  const supabase = createClient(url, serviceRoleKey);
  const { error } = await supabase.auth.admin.updateUserById(id, { password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  await supabase.from("perfis").update({ primeiro_login: true }).eq("id", id);
  return NextResponse.json({ ok: true });
}
