import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Sem cache: sempre ler dados frescos do Supabase (evita resposta com horário antigo)
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const EDGE_BASE_URL = `${SUPABASE_URL.replace(/\/$/, "")}/functions/v1/receba-sync-empresa`;
const CRON_SECRET = process.env.CRON_SECRET_KEY;

function getNowInSaoPaulo() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(now);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const weekdayRaw = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase();

  const weekdayNorm = weekdayRaw.replace("-feira", "").replace(".", "").trim();

  let diaSemana = 1;
  if (weekdayNorm.startsWith("seg")) diaSemana = 1;
  else if (weekdayNorm.startsWith("ter")) diaSemana = 2;
  else if (weekdayNorm.startsWith("qua")) diaSemana = 3;
  else if (weekdayNorm.startsWith("qui")) diaSemana = 4;
  else if (weekdayNorm.startsWith("sex")) diaSemana = 5;
  else if (weekdayNorm.startsWith("sab") || weekdayNorm.startsWith("sáb")) diaSemana = 6;
  else if (weekdayNorm.startsWith("dom")) diaSemana = 7;

  const horario = `${hour}:${minute}`;
  return { diaSemana, horario };
}

export async function GET(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados" },
        { status: 500 },
      );
    }

    if (CRON_SECRET) {
      const url = new URL(req.url);
      const authHeader = req.headers.get("x-cron-secret");
      const authQuery = url.searchParams.get("secret");
      if (authHeader !== CRON_SECRET && authQuery !== CRON_SECRET) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
      }
    }

    const { diaSemana, horario } = getNowInSaoPaulo();
    // RPC (POST) garante leitura no primary; GET em .from().select() pode ir para réplica com lag
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { "Cache-Control": "no-cache", Pragma: "no-cache" } },
    });

    // 1) Ler via RPC para forçar primary (evitar horários “fantasma” por réplica atrasada)
    const { data: ags, error: errAg } = await supabase.rpc("receba_get_api_agendamento_ativo");

    if (errAg) {
      return NextResponse.json(
        { ok: false, error: "Erro ao ler api_agendamento", detail: errAg.message },
        { status: 500 },
      );
    }

    type Ag = {
      id: string;
      api_tipos: unknown;
      dias_semana: unknown;
      horarios: unknown;
      empresa_ids: string[] | null;
      grupo_ids: string[] | null;
      ativo: boolean;
      timezone: string | null;
    };

    const lista = (ags || []) as Ag[];

    // 2) Normalizar e filtrar agendamentos que batem neste minuto (qualquer api_tipo: clientes, categorias, movimento_financeiro, movimentos_geral, pagamentos_realizados, recebimentos_omie)
    const TIPOS_SYNC = ["clientes", "categorias", "movimento_financeiro", "movimentos_geral", "pagamentos_realizados", "recebimentos_omie"];
    const alvos: { empresa_id: string; ag_id: string }[] = [];

    for (const ag of lista) {
      // Empresas alvo: diretas (empresa_ids) ou via grupo (grupo_ids → empresas ativas do grupo)
      let empresaIds: string[] = [];
      if (ag.empresa_ids && ag.empresa_ids.length > 0) {
        empresaIds = ag.empresa_ids;
      } else if (ag.grupo_ids && ag.grupo_ids.length > 0) {
        const { data: empresas } = await supabase
          .from("empresas")
          .select("id")
          .in("grupo_id", ag.grupo_ids)
          .eq("ativo", true);
        empresaIds = (empresas ?? []).map((e: { id: string }) => e.id);
      }
      if (empresaIds.length === 0) continue;

      // api_tipos -> string[]
      let apis: string[] = [];
      if (Array.isArray(ag.api_tipos)) {
        apis = (ag.api_tipos as any[]).map((x) => String(x));
      } else if (typeof ag.api_tipos === "string") {
        try {
          const parsed = JSON.parse(ag.api_tipos);
          if (Array.isArray(parsed)) {
            apis = parsed.map((x: any) => String(x));
          } else {
            apis = [ag.api_tipos];
          }
        } catch {
          apis = [ag.api_tipos];
        }
      }
      // Disparar para qualquer agendamento que tenha pelo menos um tipo de sync e bata no minuto
      const temAlgumTipo = apis.some((t) => TIPOS_SYNC.includes(t));
      if (!temAlgumTipo) continue;

      // dias_semana -> number[]
      const rawDias = ag.dias_semana;
      const dias: number[] = Array.isArray(rawDias)
        ? rawDias.map((d: any) => Number(d)).filter((d) => Number.isInteger(d))
        : [];
      if (!dias.includes(diaSemana)) continue;

      // horarios -> ["HH:MM"]
      const rawHor = ag.horarios;
      const listaHorarios: string[] = Array.isArray(rawHor)
        ? (rawHor as any[]).map((h) => String(h ?? ""))
        : typeof rawHor === "string"
        ? [rawHor]
        : [];
      const horariosNorm = listaHorarios
        .map((h) => (h || "").trim())
        .map((h) => (h.length >= 5 ? h.slice(0, 5) : h)); // corta segundos
      if (!horariosNorm.includes(horario)) continue;

      // Para este agendamento, todas as empresas (diretas ou do grupo)
      for (const empId of empresaIds) {
        alvos.push({ empresa_id: empId, ag_id: ag.id });
      }
    }

    if (!alvos.length) {
      return NextResponse.json(
        {
          ok: true,
          message: "Nenhum agendamento de movimento_financeiro para este minuto",
          diaSemana,
          horario,
          debug: {
            total_agendamentos: lista.length,
            // só para debug, mostra o que há de movimento_financeiro hoje
            exemplos: lista
              .slice(0, 10)
              .map((ag) => ({
                id: ag.id,
                api_tipos: ag.api_tipos,
                dias_semana: ag.dias_semana,
                horarios: ag.horarios,
                empresa_ids: ag.empresa_ids ?? [],
                grupo_ids: ag.grupo_ids ?? [],
              })),
          },
        },
        { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
      );
    }

    // 3) Chamar a Edge por empresa
    const results = await Promise.allSettled(
      alvos.map(async ({ empresa_id }) => {
        const url = `${EDGE_BASE_URL}?empresa_id=${encodeURIComponent(empresa_id)}`;
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            "Content-Type": "application/json",
          },
        });
        const text = await res.text();
        let body: unknown;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = { raw: text };
        }
        return { empresa_id, status: res.status, ok: res.ok, body };
      }),
    );

    const sucesso = results
      .filter((r) => r.status === "fulfilled" && (r as any).value.ok)
      .map((r: any) => r.value);
    const falhas = results
      .filter((r) => (r.status === "fulfilled" && !(r as any).value.ok) || r.status === "rejected")
      .map((r: any) => (r.status === "fulfilled" ? r.value : { error: String(r.reason) }));

    return NextResponse.json(
      {
        ok: true,
        diaSemana,
        horario,
        total_alvos: alvos.length,
        sucesso,
        falhas,
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}