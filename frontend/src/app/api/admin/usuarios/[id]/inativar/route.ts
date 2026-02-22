import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ok = await checkAdmin(request);
  if (!ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }
  const { id } = await params;
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: request.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await client.auth.getUser();
  if (user?.id === id) {
    return NextResponse.json({ error: "Você não pode inativar a si mesmo" }, { status: 400 });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Serviço não configurado" }, { status: 500 });
  }
  const admin = createClient(url, serviceKey);
  const { error } = await admin.from("perfis").update({ ativo: false }).eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
