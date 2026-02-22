import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fernet = require("fernet");
import { getEncryptionKey } from "@/lib/fernet-server";

/** Gera chave Fernet válida (32 bytes em base64url) a partir de qualquer string. */
function deriveFernetKey(password: string): string {
  const bytes = createHash("sha256").update(password, "utf8").digest();
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function POST(request: NextRequest) {
  try {
    const { valor } = await request.json();
    if (!valor || typeof valor !== "string") {
      return NextResponse.json({ error: "valor inválido" }, { status: 400 });
    }

    let key: string;
    try {
      key = getEncryptionKey();
    } catch {
      return NextResponse.json({ error: "ENCRYPTION_KEY não configurada" }, { status: 500 });
    }

    const fernetKey = deriveFernetKey(key);
    const secret = new fernet.Secret(fernetKey);
    const token = new fernet.Token({ secret });
    const encrypted = token.encode(valor.trim());

    return NextResponse.json({ encrypted });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
