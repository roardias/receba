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
  const { data: perfil } = await userClient.from("perfis").select("role, perfis_tipo_id").eq("id", user.id).single();
  const role = perfil?.role ?? "usuario";
  if (role === "adm" || role === "gerencia") return true;
  const { data: perms } = await userClient.from("perfis_tipo_permissoes").select("permissao").eq("perfis_tipo_id", perfil?.perfis_tipo_id ?? "").eq("permissao", "config_grupos_empresas_editar").maybeSingle();
  return !!perms;
}

const ALLOWED_KEYS = ["razao_social", "nome_curto", "cnpj", "grupo_id", "app_key", "app_secret", "app_secret_encrypted", "ativo"];

function buildPayload(body: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (key in body) payload[key] = body[key];
  }
  return payload;
}

/**
 * POST /api/empresas
 * Cria empresa usando service_role para gravar app_secret (texto).
 * app_secret é gravado em um update separado para garantir persistência (mesma lógica do PATCH).
 */
export async function POST(request: NextRequest) {
  const token = getAuthHeaders(request);
  if (!token) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!(await checkPermissao(token))) return NextResponse.json({ error: "Sem permissão para editar empresas" }, { status: 403 });
  if (!serviceRoleKey) return NextResponse.json({ error: "SUPABASE_SERVICE_ROLE_KEY não configurada" }, { status: 500 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const payload = buildPayload(body);
  const { app_secret: appSecretVal, ...rest } = payload as Record<string, unknown> & { app_secret?: string };
  const insertPayload = Object.keys(rest).length > 0 ? rest : {};
  if (Object.keys(insertPayload).length === 0) {
    return NextResponse.json({ error: "Dados obrigatórios faltando (ex.: razao_social, nome_curto)" }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey);
  const { data: inserted, error: insertError } = await supabase
    .from("empresas")
    .insert(insertPayload)
    .select("id, nome_curto, app_key")
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });
  const id = (inserted as { id: string }).id;

  if (appSecretVal !== undefined && appSecretVal !== null && String(appSecretVal).trim() !== "") {
    const secretToSave = typeof appSecretVal === "string" ? appSecretVal.trim() : String(appSecretVal);
    const { error: secretError } = await supabase
      .from("empresas")
      .update({ app_secret: secretToSave })
      .eq("id", id);
    if (secretError) {
      return NextResponse.json(
        { error: secretError.message, _hint: "Empresa criada, mas app_secret não foi gravado. Edite a empresa e salve o App Secret novamente." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(inserted);
}
