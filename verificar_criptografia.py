"""
Verifica se a criptografia está alinhada entre frontend e backend.
- Carrega .env como o scheduler (raiz + frontend/.env.local sem sobrescrever ENCRYPTION_KEY).
- Tenta descriptografar um app_secret_encrypted do Supabase.
Execute: python verificar_criptografia.py
"""
import os
import sys

# Carregar .env como o scheduler
_root = os.path.dirname(os.path.abspath(__file__))
_env_path = os.path.join(_root, ".env")
_env_local = os.path.join(_root, "frontend", ".env.local")

if os.path.isfile(_env_path):
    from dotenv import load_dotenv
    load_dotenv(_env_path)
if os.path.isfile(_env_local):
    load_dotenv(_env_local, override=False)

def main():
    key = (os.getenv("ENCRYPTION_KEY") or "").strip()
    if not key:
        print("ERRO: ENCRYPTION_KEY não definida no .env da raiz.")
        print("  Defina no .env e use a MESMA valor em frontend/.env.local")
        return 1

    # Mostrar início/fim da chave para comparar com frontend
    key_preview = key[:4] + "..." + key[-4:] if len(key) > 8 else "****"
    print(f"ENCRYPTION_KEY (backend): {key_preview}")

    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    sk = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not sk:
        print("ERRO: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) no .env")
        return 1

    from supabase import create_client
    from utils.criptografia import descriptografar

    supabase = create_client(url, sk)

    # Selecionar colunas que existem (app_secret pode não existir se a migration não foi aplicada)
    try:
        res = supabase.from_("empresas").select("id, nome_curto, app_secret, app_secret_encrypted").eq("ativo", True).execute()
    except Exception as e:
        if "app_secret" in str(e) and "does not exist" in str(e).lower():
            print("\nAVISO: A coluna empresas.app_secret não existe no banco.")
            print("  Rode a migration: supabase/migrations/empresas_app_secret_plain.sql")
            print("  Ou no Supabase SQL: ALTER TABLE empresas ADD COLUMN IF NOT EXISTS app_secret TEXT;")
            res = supabase.from_("empresas").select("id, nome_curto, app_secret_encrypted").eq("ativo", True).execute()
        else:
            raise
    rows = res.data or []

    # Empresas que dependem de descriptografia (sem app_secret em texto)
    sem_plain = [r for r in rows if not (r.get("app_secret") or "").strip() and (r.get("app_secret_encrypted") or "").strip()]
    com_plain = [r for r in rows if (r.get("app_secret") or "").strip()]

    print(f"\nEmpresas com app_secret (texto): {len(com_plain)} — scheduler usa direto, sem criptografia.")
    print(f"Empresas só com app_secret_encrypted: {len(sem_plain)} — scheduler precisa descriptografar.")

    if not sem_plain:
        print("\nNão há empresa só com app_secret_encrypted. Tudo usa texto ou está vazio.")
        return 0

    # Testar descriptografia na primeira que tem encrypted
    r = sem_plain[0]
    nome = r.get("nome_curto") or r.get("id")
    enc = (r.get("app_secret_encrypted") or "").strip()
    dec = descriptografar(enc)

    if dec:
        print(f"\nOK — Descriptografia funcionou para '{nome}' (secret começa com {dec[:4]}...)")
        print("  Backend e frontend estão com a mesma ENCRYPTION_KEY.")
        return 0

    print("\nFALHA — Não foi possível descriptografar o app_secret_encrypted de '%s'." % nome)
    print("  Isso acontece quando o valor foi criptografado com OUTRA chave (ex.: frontend tinha ENCRYPTION_KEY diferente).")
    print("")
    print("  SOLUÇÃO:")
    print("  1. Adicione a coluna app_secret no Supabase (se ainda não existir):")
    print("     ALTER TABLE empresas ADD COLUMN IF NOT EXISTS app_secret TEXT;")
    print("  2. No frontend (Configurações > Empresas), edite cada empresa que está com erro,")
    print("     cole o App Secret da Omie de novo e salve. Assim será gravado app_secret (texto) e")
    print("     app_secret_encrypted (com a chave atual); o scheduler usará o texto e tudo volta a funcionar.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
