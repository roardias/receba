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
  const weekdayShort = (parts.find((p) => p.type === "weekday")?.value ?? "").toLowerCase();

  const mapDia: Record<string, number> = {
    seg: 1,
    ter: 2,
    qua: 3,
    qui: 4,
    sex: 5,
    sáb: 6,
    sab: 6,
    dom: 7,
  };

  const diaSemana = mapDia[weekdayShort] ?? 1;
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
      const auth = req.headers.get("x-cron-secret");
      if (auth !== CRON_SECRET) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
      }
    }

    const { diaSemana, horario } = getNowInSaoPaulo();
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: rows, error: errRpc } = await supabase.rpc(
      "receba_sync_agendamentos_expandidos",
    );

    if (errRpc) {
      return NextResponse.json(
        { error: "receba_sync_agendamentos_expandidos", detail: errRpc.message },
        { status: 500 },
      );
    }

    if (!rows || !rows.length) {
      return NextResponse.json({ ok: true, message: "Nenhum agendamento ativo", diaSemana, horario });
    }

    type Row = {
      empresa_id: string;
      dias_semana: number[];
      horarios: string[];
      api_tipos: string[];
      timezone: string;
    };

    const alvos: Row[] = (rows as Row[]).filter((r) => {
      const dias = Array.isArray(r.dias_semana) ? r.dias_semana : [];
      const horarios = Array.isArray(r.horarios) ? r.horarios : [];
      const apis = Array.isArray(r.api_tipos) ? r.api_tipos : [];
      const temMov = apis.includes("movimento_financeiro");
      const diaConf = dias.includes(diaSemana);
      const horaConf = horarios.includes(horario);
      return temMov && diaConf && horaConf;
    });

    if (!alvos.length) {
      return NextResponse.json({
        ok: true,
        message: "Nenhum agendamento de movimento_financeiro para este minuto",
        diaSemana,
        horario,
      });
    }

    const results = await Promise.allSettled(
      alvos.map(async (row) => {
        const url = `${EDGE_BASE_URL}?empresa_id=${encodeURIComponent(row.empresa_id)}`;
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
        return { empresa_id: row.empresa_id, status: res.status, ok: res.ok, body };
      }),
    );

    const sucesso = results
      .filter((r) => r.status === "fulfilled" && (r as any).value.ok)
      .map((r: any) => r.value);
    const falhas = results
      .filter((r) => r.status === "fulfilled" && !(r as any).value.ok || r.status === "rejected")
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

