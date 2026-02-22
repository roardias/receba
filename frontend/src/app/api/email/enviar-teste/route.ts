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
    const toEmail = body.to_email as string | undefined;
    const subject = body.subject as string | undefined;
    const descricao = body.descricao as string | undefined;

    if (!configEmailId?.trim() || !toEmail?.trim() || !subject?.trim()) {
      return NextResponse.json(
        { error: "Informe a configuração de e-mail, o destinatário e o assunto." },
        { status: 400 }
      );
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

    const c = config as ConfigEmail;
    if (!c.client_secret_encrypted) {
      return NextResponse.json(
        { error: "Esta configuração não possui Client Secret. Edite e salve o secret para enviar testes." },
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

    const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.sender_mailbox)}/sendMail`;
    const content = (descricao && descricao.trim()) ? descricao.trim() : "E-mail de teste do sistema Recebx.";
    const sendBody = {
      message: {
        subject: subject.trim(),
        body: {
          contentType: "Text",
          content,
        },
        toRecipients: [
          {
            emailAddress: {
              address: toEmail.trim(),
            },
          },
        ],
      },
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

    return NextResponse.json({ ok: true, message: "E-mail de teste enviado." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao enviar e-mail de teste." },
      { status: 500 }
    );
  }
}
