/**
 * Remove do início do nome o padrão "N - " (número + " - ").
 * Ex.: "1087 - M5 Seguranca Ltda" → "M5 Seguranca Ltda".
 * Se não existir esse padrão, retorna o nome original (trimmed).
 */
export function normalizarClienteNome(nome: string | null | undefined): string | null {
  if (nome == null || typeof nome !== "string") return null;
  const t = nome.trim();
  if (!t) return null;
  const semPrefixo = t.replace(/^\d+\s*-\s*/, "").trim();
  return semPrefixo || t;
}
