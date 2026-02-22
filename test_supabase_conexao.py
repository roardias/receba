"""
Teste de conexão com o Supabase.
Verifica se as credenciais estão corretas e se consegue acessar o banco.
"""
import os
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")

    if not url:
        print("SUPABASE_URL não encontrada no .env")
        return
    if not key:
        print("SUPABASE_KEY não encontrada no .env")
        return

    print(f"URL: {url}")
    print("Testando conexão...")

    try:
        supabase = create_client(url, key)
        # Teste simples: SELECT na tabela clientes (limite 1)
        result = supabase.table("clientes").select("id, empresa, codigo_cliente_omie").limit(1).execute()
        print("OK - Conexão estabelecida.")
        print(f"  Tabela 'clientes' acessível. Registros retornados: {len(result.data)}")
        if result.data:
            print(f"  Exemplo: {result.data[0]}")
    except Exception as e:
        print(f"ERRO: {e}")


if __name__ == "__main__":
    main()
