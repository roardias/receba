import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/fernet-server";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

type ConfigEmail = {
  id: string;
  tenant_id: string;
  client_id: string;
  client_secret_encrypted: string | null;
  sender_mailbox: string;
  sender_name: string;
};

export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const configEmailId = body.config_email_id as string | undefined;
    const empresaIds = body.empresa_ids as string[] | undefined;
    const toEmails = body.to_emails as string[] | undefined;
    const subject = body.subject as string | undefined;
    const content = body.body as string | undefined;
    let bodyHtml = body.body_html as string | undefined;
    const logoUrl = body.logo_url as string | undefined;
    const cobrancaClientes = body.cobranca_clientes as { cod_cliente?: string; cnpj_cpf?: string; cliente_nome?: string; grupo_nome?: string }[] | undefined;
    const empresasInternasNomes = (body.empresas_internas_nomes as string)?.trim() || null;

    if (!configEmailId?.trim() || !Array.isArray(toEmails) || toEmails.length === 0 || !subject?.trim()) {
      return NextResponse.json(
        { error: "Informe a configuração de e-mail, ao menos um destinatário e o assunto." },
        { status: 400 }
      );
    }

    const contextEmpresaIds = Array.isArray(empresaIds)
      ? (empresaIds as unknown[]).filter((id): id is string => typeof id === "string" && id.trim().length > 0).map((id) => id.trim())
      : [];

    const addresses = toEmails
      .map((e) => (typeof e === "string" ? e : "").trim())
      .filter((e) => e.length > 0);
    if (addresses.length === 0) {
      return NextResponse.json({ error: "Nenhum e-mail de destinatário válido." }, { status: 400 });
    }

    const supabase = createClient(url, anonKey, {
      global: { headers: { Authorization: auth } },
    });

    const { data: config, error: configError } = await supabase
      .from("config_email")
      .select("id, tenant_id, client_id, client_secret_encrypted, sender_mailbox, sender_name")
      .eq("id", configEmailId.trim())
      .single();

    if (configError || !config) {
      return NextResponse.json(
        { error: configError?.message || "Configuração de e-mail não encontrada." },
        { status: 404 }
      );
    }

    if (contextEmpresaIds.length > 0) {
      const { data: permitidos } = await supabase
        .from("config_email_empresas")
        .select("empresa_id")
        .eq("config_email_id", configEmailId.trim());
      const idsPermitidos = new Set((permitidos || []).map((r) => (r as { empresa_id: string }).empresa_id));
      const todasPermitidas = contextEmpresaIds.every((id) => idsPermitidos.has(id));
      if (!todasPermitidas) {
        return NextResponse.json(
          { error: "Esta configuração de e-mail não está autorizada para as empresas selecionadas no filtro do dashboard." },
          { status: 403 }
        );
      }
    }

    const c = config as ConfigEmail;
    if (!c.client_secret_encrypted) {
      return NextResponse.json(
        { error: "Esta configuração não possui Client Secret. Edite e salve o secret para enviar." },
        { status: 400 }
      );
    }

    if (!process.env.ENCRYPTION_KEY?.trim()) {
      return NextResponse.json(
        {
          error:
            "ENCRYPTION_KEY não configurada. No Vercel: Settings → Environment Variables → adicione ENCRYPTION_KEY com o mesmo valor do seu .env local (a chave usada ao salvar o Client Secret).",
        },
        { status: 500 }
      );
    }

    let clientSecret: string;
    try {
      clientSecret = decrypt(c.client_secret_encrypted);
    } catch {
      return NextResponse.json(
        {
          error:
            "Não foi possível descriptografar o Client Secret. Confira se ENCRYPTION_KEY no Vercel é exatamente a mesma do .env local (copie e cole, sem espaços extras).",
        },
        { status: 500 }
      );
    }

    const tokenUrl = `https://login.microsoftonline.com/${c.tenant_id}/oauth2/v2.0/token`;
    const tokenParams = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.client_id,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return NextResponse.json(
        { error: "Falha ao obter token Microsoft: " + (errText || tokenRes.statusText) },
        { status: 502 }
      );
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: "Resposta Microsoft sem access_token." },
        { status: 502 }
      );
    }

    const LOGO_PLACEHOLDER = "__LOGO_SRC__";
    const LOGO_CID = "logo";
    let logoAttachment: { contentBytes: string; contentType: string } | null = null;

    if (bodyHtml && bodyHtml.includes(LOGO_PLACEHOLDER) && logoUrl && typeof logoUrl === "string" && logoUrl.trim()) {
      const url = logoUrl.trim();
      if (url.startsWith("data:")) {
        const match = url.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          logoAttachment = {
            contentType: match[1].trim(),
            contentBytes: match[2],
          };
        }
        bodyHtml = bodyHtml.replace(LOGO_PLACEHOLDER, `cid:${LOGO_CID}`);
      } else if (url.startsWith("http://") || url.startsWith("https://")) {
        try {
          const imgRes = await fetch(url);
          if (imgRes.ok) {
            const buf = await imgRes.arrayBuffer();
            const contentType = imgRes.headers.get("content-type") || "image/png";
            logoAttachment = {
              contentType,
              contentBytes: Buffer.from(buf).toString("base64"),
            };
          }
          bodyHtml = bodyHtml.replace(LOGO_PLACEHOLDER, `cid:${LOGO_CID}`);
        } catch {
          bodyHtml = bodyHtml.replace(LOGO_PLACEHOLDER, "");
        }
      } else {
        bodyHtml = bodyHtml.replace(LOGO_PLACEHOLDER, "");
      }
    } else if (bodyHtml && bodyHtml.includes(LOGO_PLACEHOLDER)) {
      bodyHtml = bodyHtml.replace(LOGO_PLACEHOLDER, "");
    }

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender_mailbox)}/sendMail`;
    const useHtml = bodyHtml && bodyHtml.trim().length > 0;
    const messagePayload: Record<string, unknown> = {
      subject: subject.trim(),
      body: {
        contentType: useHtml ? "HTML" : "Text",
        content: useHtml ? (bodyHtml ?? "").trim() : ((content && content.trim()) ? content.trim() : ""),
      },
      toRecipients: addresses.map((address) => ({
        emailAddress: { address },
      })),
    };
    if (logoAttachment) {
      messagePayload.attachments = [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: LOGO_CID,
          contentType: logoAttachment.contentType,
          contentBytes: logoAttachment.contentBytes,
          contentId: LOGO_CID,
          isInline: true,
        },
      ];
    }
    const sendBody = {
      message: messagePayload,
      saveToSentItems: true,
    };

    const sendRes = await fetch(graphUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sendBody),
    });

    if (!sendRes.ok) {
      const errJson = await sendRes.json().catch(() => ({}));
      const msg = (errJson as { error?: { message?: string } })?.error?.message || sendRes.statusText;
      return NextResponse.json(
        { error: "Falha ao enviar e-mail: " + msg },
        { status: 502 }
      );
    }

    const clientes = Array.isArray(cobrancaClientes) && cobrancaClientes.length > 0
      ? cobrancaClientes.map((x) => ({
          cod_cliente: typeof x?.cod_cliente === "string" ? x.cod_cliente.trim() || null : null,
          cnpj_cpf: typeof x?.cnpj_cpf === "string" ? x.cnpj_cpf.trim() || null : null,
          cliente_nome: typeof x?.cliente_nome === "string" ? x.cliente_nome.trim() || null : null,
          grupo_nome: typeof x?.grupo_nome === "string" ? x.grupo_nome.trim() || null : null,
        }))
      : [];
    if (clientes.length > 0) {
      const registroId = crypto.randomUUID();
      const now = new Date().toISOString();
      const rows = clientes.map((cliente) => ({
        registro_id: registroId,
        tipo: "email",
        cod_cliente: cliente.cod_cliente,
        cnpj_cpf: cliente.cnpj_cpf,
        cliente_nome: cliente.cliente_nome,
        grupo_nome: cliente.grupo_nome,
        empresas_internas_nomes: empresasInternasNomes,
        emails_destinatarios: addresses.join(", "),
        email_remetente: c.sender_mailbox,
      }));
      await supabase.from("cobrancas_realizadas").insert(rows);
    }

    return NextResponse.json({ ok: true, message: "E-mail(s) enviado(s)." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao enviar e-mail." },
      { status: 500 }
    );
  }
}
