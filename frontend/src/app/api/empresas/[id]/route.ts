import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * PATCH /api/empresas/[id]
 * Atualiza uma empresa usando service_role para garantir que app_secret (texto) seja gravado.
 * O cliente anon pode ter RLS ou restrição que impede atualizar essa coluna.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  }
  if (!serviceRoleKey) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY não configurada" },
      { status: 500 }
    );
  }

  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const token = auth.slice(7);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const { data: perfil } = await userClient.from("perfis").select("role, perfis_tipo_id").eq("id", user.id).single();
  const role = perfil?.role ?? "usuario";
  if (role !== "adm" && role !== "gerencia") {
    const { data: perms } = await userClient.from("perfis_tipo_permissoes").select("permissao").eq("perfis_tipo_id", perfil?.perfis_tipo_id ?? "").eq("permissao", "config_grupos_empresas_editar").maybeSingle();
    if (!perms) {
      return NextResponse.json({ error: "Sem permissão para editar empresas" }, { status: 403 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const allowedKeys = [
    "razao_social", "nome_curto", "cnpj", "grupo_id", "app_key",
    "app_secret", "app_secret_encrypted", "ativo",
  ];
  const payload: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (key in body) {
      payload[key] = body[key];
    }
  }

  // Log para diagnóstico (aparece no terminal do npm run dev)
  console.log("[PATCH /api/empresas] id:", id, "payload keys:", Object.keys(payload), "tem app_secret:", "app_secret" in payload);

  const supabase = createClient(url, serviceRoleKey);

  const { app_secret: appSecretVal, ...rest } = payload as Record<string, unknown> & { app_secret?: string | null };

  // 1) Se veio app_secret, gravar PRIMEIRO (assim, ao editar só o secret, ele já é salvo mesmo se o passo 2 falhar)
  if ("app_secret" in payload) {
    const value = appSecretVal === undefined || appSecretVal === null || (typeof appSecretVal === "string" && !appSecretVal.trim())
      ? null
      : typeof appSecretVal === "string"
        ? appSecretVal.trim()
        : String(appSecretVal);
    const { error: errSecret } = await supabase
      .from("empresas")
      .update({ app_secret: value })
      .eq("id", id);
    if (errSecret) {
      console.error("[PATCH /api/empresas] Erro ao gravar app_secret:", errSecret.message, "code:", errSecret.code);
      return NextResponse.json(
        {
          error: errSecret.message,
          _step: "update_app_secret",
          _hint: "Confira se a coluna empresas.app_secret existe no Supabase (migration empresas_app_secret_plain.sql).",
        },
        { status: 500 }
      );
    }
    console.log("[PATCH /api/empresas] app_secret gravado com sucesso");
  }

  // 2) Atualizar os demais campos
  const updateRest = Object.keys(rest).length > 0 ? rest : undefined;
  if (updateRest) {
    const { data: dataUpdate, error: errRest } = await supabase
      .from("empresas")
      .update(updateRest)
      .eq("id", id)
      .select("id");
    if (errRest) {
      console.error("[PATCH /api/empresas] Erro no update (campos gerais):", errRest.message, "code:", errRest.code);
      return NextResponse.json(
        {
          error: errRest.message,
          _step: "update_rest",
          _code: errRest.code,
          _hint: errRest.code === "23505" ? "Conflito de unicidade (ex.: nome_curto já existe em outra empresa)." : undefined,
        },
        { status: 500 }
      );
    }
    const rowCount = Array.isArray(dataUpdate) ? dataUpdate.length : (dataUpdate ? 1 : 0);
    if (rowCount === 0) {
      console.error("[PATCH /api/empresas] Nenhuma linha atualizada para id:", id);
      return NextResponse.json(
        { error: "Nenhum registro encontrado com esse id.", _step: "update_rest" },
        { status: 404 }
      );
    }
    console.log("[PATCH /api/empresas] Campos gerais atualizados, linhas:", rowCount);
  }

  if ("app_secret" in payload) {
    const value = appSecretVal === undefined || appSecretVal === null || (typeof appSecretVal === "string" && !appSecretVal.trim())
      ? null
      : typeof appSecretVal === "string"
        ? appSecretVal.trim()
        : String(appSecretVal);
    const saved = value !== null && value !== "";
    return NextResponse.json({
      id,
      nome_curto: (payload.nome_curto as string) ?? null,
      app_key: (payload.app_key as string) ?? null,
      app_secret: saved ? "[gravado]" : null,
      _debug_app_secret_saved: saved,
    });
  }

  console.log("[PATCH /api/empresas] Atualização concluída (sem app_secret no payload)");

  const { data } = await supabase.from("empresas").select("id, nome_curto, app_key").eq("id", id).single();
  return NextResponse.json({
    id: (data as Record<string, unknown>)?.id,
    nome_curto: (data as Record<string, unknown>)?.nome_curto,
    app_key: (data as Record<string, unknown>)?.app_key,
  });
}
