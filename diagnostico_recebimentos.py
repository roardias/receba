"""
Diagnóstico: por que os recebimentos não estão sendo importados?
Rode: python diagnostico_recebimentos.py
Requer .env com SUPABASE_URL, SUPABASE_KEY e uma empresa com app_key/app_secret (ex.: Alldax 3).
"""
import os
import sys
from pathlib import Path

# raiz do projeto
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dotenv import load_dotenv
load_dotenv()

from supabase import create_client
from api_omie_recebimentos import listar_recebimentos_paginado

def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Configure SUPABASE_URL e SUPABASE_KEY no .env")
        return 1

    supabase = create_client(url, key)

    # 1) Empresas no banco
    res_emp = supabase.from_("empresas").select("id, nome_curto").eq("ativo", True).limit(5).execute()
    empresas = res_emp.data or []
    if not empresas:
        print("Nenhuma empresa ativa no banco.")
        return 1
    print("Empresas (amostra):", [e["nome_curto"] for e in empresas])

    # 2) Clientes: coluna empresa existe? Valores de empresa e chave_unica
    try:
        res_c = supabase.from_("clientes").select("empresa, chave_unica, codigo_cliente_omie").limit(5).execute()
        clientes_amostra = res_c.data or []
        print("\nClientes (amostra 5):")
        for c in clientes_amostra:
            print("  empresa=%r chave_unica=%r codigo=%r" % (c.get("empresa"), c.get("chave_unica"), c.get("codigo_cliente_omie")))
    except Exception as e:
        print("\nErro ao ler clientes (coluna 'empresa' existe?):", e)
        try:
            res_c2 = supabase.from_("clientes").select("chave_unica").limit(3).execute()
            print("  chave_unica (sem empresa):", [r.get("chave_unica") for r in (res_c2.data or [])])
        except Exception as e2:
            print("  ", e2)

    # 3) Contar clientes por nome (empresa)
    nome_teste = empresas[0]["nome_curto"]
    try:
        res_count = supabase.from_("clientes").select("chave_unica", count="exact").eq("empresa", nome_teste).execute()
        count = getattr(res_count, "count", None) or len(res_count.data or [])
        print("\nClientes com empresa=%r: %s" % (nome_teste, count))
        if res_count.data:
            print("  Amostra chave_unica:", [r["chave_unica"] for r in (res_count.data or [])[:3]])
    except Exception as e:
        print("\nErro ao filtrar clientes por empresa=%r: %s" % (nome_teste, e))

    # 4) Chamar API (só 1 página) para uma empresa - precisa de app_key/app_secret
    from utils.criptografia import descriptografar
    res_emp_full = supabase.from_("empresas").select("id, nome_curto, app_key, app_secret_encrypted").eq("nome_curto", nome_teste).limit(1).execute()
    if not res_emp_full.data or not res_emp_full.data[0].get("app_key"):
        print("\nAPI: sem credenciais para empresa %r (pule este passo ou use outra empresa)." % nome_teste)
        return 0
    emp = res_emp_full.data[0]
    app_key = emp["app_key"]
    app_secret = descriptografar(emp.get("app_secret_encrypted") or "") or ""
    if not app_secret:
        print("\nAPI: app_secret vazio para %r." % nome_teste)
        return 0
    print("\nChamando API Omie (recebimentos) para %r..." % nome_teste)
    try:
        registros, _ = listar_recebimentos_paginado(app_key, app_secret, nome_teste, verbose=False)
        print("  API devolveu %d movimentos." % len(registros))
        if registros:
            r0 = registros[0]
            keys_cli = [k for k in r0 if "cod" in k.lower() and "cliente" in k.lower()]
            print("  Keys com 'cod'+'cliente' na 1ª linha:", keys_cli)
            for k in keys_cli:
                print("    %s = %r" % (k, r0.get(k)))
            cod = r0.get("det_nCodCliente") or r0.get("det_nCodcliente") or r0.get("det_ncodcliente")
            chave_montada = "%s_%s" % (nome_teste, (cod or "").strip())
            print("  Chave montada (nome_codigo): %r" % chave_montada)
            # Verificar se está em clientes
            res_chave = supabase.from_("clientes").select("chave_unica").eq("chave_unica", chave_montada).execute()
            existe = bool(res_chave.data)
            print("  Essa chave existe em clientes? %s" % existe)
    except Exception as e:
        print("  Erro ao chamar API:", e)

    print("\n--- Fim do diagnóstico ---")
    return 0

if __name__ == "__main__":
    exit(main())
