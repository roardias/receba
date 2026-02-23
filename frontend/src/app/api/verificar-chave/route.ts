import { NextResponse } from "next/server";
import { getEncryptionKey } from "@/lib/fernet-server";

/**
 * GET /api/verificar-chave
 * Retorna o prefixo da ENCRYPTION_KEY para comparar com o .env da raiz.
 * O scheduler usa a chave do .env da raiz; o frontend usa a do .env.local.
 * Devem ser idênticas para criptografia/descriptografia bater.
 */
export async function GET() {
  try {
    const key = getEncryptionKey();
    const prefix = key.length >= 4 ? key.slice(0, 4) : "****";
    const suffix = key.length >= 4 ? key.slice(-4) : "****";
    return NextResponse.json({
      ok: true,
      keyPreview: `${prefix}...${suffix}`,
      message:
        "Compare com o .env da raiz: ENCRYPTION_KEY deve ser exatamente igual ao do frontend/.env.local",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "ENCRYPTION_KEY não configurada no frontend/.env.local" },
      { status: 500 }
    );
  }
}
