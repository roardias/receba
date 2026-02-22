import { createHash } from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fernet = require("fernet");

/** Normaliza ENCRYPTION_KEY para evitar diferenças entre local e Vercel (aspas, BOM, espaços). */
export function getEncryptionKey(): string {
  let key = (process.env.ENCRYPTION_KEY ?? "").trim();
  key = key.replace(/^\uFEFF/, ""); // BOM
  key = key.replace(/^["']|["']$/g, "").trim(); // aspas ao redor
  if (!key) throw new Error("ENCRYPTION_KEY não configurada");
  return key;
}

/** Gera chave Fernet válida (32 bytes em base64url) a partir de qualquer string. */
function deriveFernetKey(password: string): string {
  const bytes = createHash("sha256").update(password, "utf8").digest();
  return bytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Descriptografa um valor cifrado com a mesma chave usada em /api/criptografar. Uso apenas no servidor. */
export function decrypt(encrypted: string): string {
  const key = getEncryptionKey();
  const fernetKey = deriveFernetKey(key);
  const secret = new fernet.Secret(fernetKey);
  const token = new fernet.Token({ secret, token: encrypted, ttl: 0 });
  return token.decode();
}
