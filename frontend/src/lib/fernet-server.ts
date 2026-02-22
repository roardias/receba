import { createHash } from "crypto";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fernet = require("fernet");

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
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error("ENCRYPTION_KEY não configurada");
  const fernetKey = deriveFernetKey(key);
  const secret = new fernet.Secret(fernetKey);
  const token = new fernet.Token({ secret, token: encrypted, ttl: 0 });
  return token.decode();
}
