"""
Gera uma nova ENCRYPTION_KEY para o .env.
Execute: python gerar_chave_criptografia.py
"""
from utils.criptografia import gerar_chave

if __name__ == "__main__":
    key = gerar_chave()
    print("Adicione ao seu .env:")
    print(f"ENCRYPTION_KEY={key}")
