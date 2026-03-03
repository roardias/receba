/**
 * Código completo da Edge Function: receba-sync-scheduler
 *
 * Colar este arquivo no Supabase: Edge Functions → receba-sync-scheduler → index.ts
 *
 * Secrets obrigatórias no Supabase (Edge Function):
 *   - SUPABASE_URL (ex: https://xxx.supabase.co)
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Depende de:
 *   - Migration receba_pg_cron_wrappers.sql (receba_cron_unschedule_all, receba_cron_schedule)
 *   - Migration receba_sync_agendamentos_expandidos.sql (RPC que expande grupos em empresas)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// America/Sao_Paulo = UTC-3 → soma 3 na hora para obter UTC
function localToUtcHour(localHour: number, localMinute: number, tz: string): { hour: number; minute: number } {
  if (tz?.includes("Sao_Paulo") || tz === "America/Sao_Paulo" || !tz) {
    const utcHour = localHour + 3;
    if (utcHour >= 24) return { hour: utcHour - 24, minute: localMinute };
    return { hour: utcHour, minute: localMinute };
  }
  // Outros fusos: default UTC-3 (Brasília)
  const utcHour = localHour + 3;
  if (utcHour >= 24) return { hour: utcHour - 24, minute: localMinute };
  return { hour: utcHour, minute: localMinute };
}

// Cron usa 0=Dom, 1=Seg, ..., 6=Sab. Nosso dias_semana: 1=Seg, ..., 7=Dom.
function toCronDayOfWeek(dia: number): number {
  return dia === 7 ? 0 : dia;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY devem estar definidos nas secrets da função." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // 1) Remover todos os jobs receba_sync_*
    const { data: removed, error: errUnsched } = await supabase.rpc("receba_cron_unschedule_all");
    if (errUnsched) {
      return new Response(
        JSON.stringify({ error: "receba_cron_unschedule_all: " + errUnsched.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2) Buscar agendamentos já expandidos (grupos → empresas)
    const { data: rows, error: errRpc } = await supabase.rpc("receba_sync_agendamentos_expandidos");
    if (errRpc) {
      return new Response(
        JSON.stringify({ error: "receba_sync_agendamentos_expandidos: " + errRpc.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rows?.length) {
      return new Response(
        JSON.stringify({ jobs_criados: 0, removidos: removed ?? 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const baseUrl = supabaseUrl + "/functions/v1/receba-sync-empresa";
    let jobsCriados = 0;
    const erros: string[] = [];

    for (const row of rows) {
      const empresaId = row.empresa_id as string;
      const diasSemana: number[] = Array.isArray(row.dias_semana) ? row.dias_semana : [];
      const horarios: string[] = Array.isArray(row.horarios) ? row.horarios : [];
      const tz = (row.timezone as string) || "America/Sao_Paulo";

      for (const dia of diasSemana) {
        for (const horario of horarios) {
          if (!horario || typeof horario !== "string") continue;
          const [h, m] = horario.trim().split(":").map((x: string) => parseInt(x, 10) || 0);
          const { hour: utcH, minute: utcM } = localToUtcHour(h, m, tz);
          const cronDow = toCronDayOfWeek(dia);
          const schedule = `${utcM} ${utcH} * * ${cronDow}`;
          // Tipo "empresa" no nome evita colisão com outros jobs (ex.: receba_sync_recebimentos_...) no futuro
          const jobName = `receba_sync_empresa_${(empresaId as string).replace(/-/g, "_")}_${dia}_${String(horario).replace(":", "")}`;
          const urlWithParam = `${baseUrl}?empresa_id=${encodeURIComponent(empresaId)}`;
          // Escapar aspas simples na chave para uso dentro de SQL
          const keyEscaped = (serviceRoleKey ?? "").replace(/'/g, "''").replace(/\\/g, "\\\\");
          const sqlBlock = `SELECT net.http_post(
  url := '${urlWithParam}',
  headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ${keyEscaped}'),
  body := '{}'::jsonb
);`;

          const { error: errSchedule } = await supabase.rpc("receba_cron_schedule", {
            job_name: jobName,
            schedule,
            sql_block: sqlBlock,
          });

          if (errSchedule) {
            const msg = `${jobName}: ${errSchedule.message}`;
            erros.push(msg);
            if (erros.length <= 3) console.error("receba_cron_schedule", jobName, errSchedule);
          } else {
            jobsCriados++;
          }
        }
      }
    }

    const body: Record<string, unknown> = { jobs_criados: jobsCriados, removidos: removed ?? 0 };
    if (erros.length > 0) body.erros = erros.slice(0, 5);
    if (erros.length > 0 && jobsCriados === 0) body.primeiro_erro = erros[0];

    return new Response(
      JSON.stringify(body),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
