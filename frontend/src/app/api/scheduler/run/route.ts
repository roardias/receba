import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1) Ler DIRETO da tabela api_agendamento
    const { data: ags, error: errAg } = await supabase
      .from("api_agendamento")
      .select("id, api_tipos, dias_semana, horarios, empresa_ids, ativo, timezone")
      .eq("ativo", true);

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
      ativo: boolean;
      timezone: string | null;
    };

    const lista = (ags || []) as Ag[];

    // 2) Normalizar e filtrar só movimento_financeiro neste minuto
    const alvos: { empresa_id: string; ag_id: string }[] = [];

    for (const ag of lista) {
      if (!ag.empresa_ids || ag.empresa_ids.length === 0) continue;

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
      if (!apis.includes("movimento_financeiro")) continue;

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

      // Para este agendamento, todas as empresas marcadas
      for (const empId of ag.empresa_ids) {
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
              .map((ag) => ({ id: ag.id, api_tipos: ag.api_tipos, dias_semana: ag.dias_semana, horarios: ag.horarios })),
          },
        },
        { status: 200 },
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
      { status: 200 },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}