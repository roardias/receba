import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getAuthHeaders(request: NextRequest): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

async function checkPermissao(token: string): Promise<boolean> {
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return false;
  const { data: perfil } = await userClient.from("perfis").select("role").eq("id", user.id).single();
  const role = perfil?.role ?? "usuario";
  return role === "adm" || role === "gerencia";
}

/**
 * GET /api/configurar-sincronizacao
 * Chama a Edge Function receba-sync-scheduler para aplicar agendamentos no pg_cron (Supabase).
 * Só adm e gerência podem chamar.
 */
export async function GET(request: NextRequest) {
  const token = getAuthHeaders(request);
  if (!token) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await checkPermissao(token))) return NextResponse.json({ error: "Sem permissão. Apenas Admin e Gerência." }, { status: 403 });
  if (!serviceRoleKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada" }, { status: 500 });

  const baseUrl = (url || "").replace(/\/$/, "");
  const fnUrl = `${baseUrl}/functions/v1/receba-sync-scheduler`;

  try {
    const res = await fetch(fnUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: "Erro ao chamar o scheduler", detail: data, status: res.status },
        { status: 502 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro ao chamar o scheduler";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
