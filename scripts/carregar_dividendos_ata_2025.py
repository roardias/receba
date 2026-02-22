"""
Carrega dividendos_ata_2025 a partir do CSV (todos da empresa Iris).
CPF: armazena somente números (remove ponto e traço).
Valor: converte "R$ 1.000,00" para numérico.
"""
import csv
import re
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

CSV_PATH = Path(__file__).resolve().parent.parent / "dividendos ata 2025.csv"

# Empresa Iris (PK no Supabase)
EMPRESA_IRIS_ID = "1012591f-e0c0-414a-b739-33224aa6290e"


def apenas_numeros_cpf(s: str) -> str:
    return re.sub(r"[^0-9]", "", s or "")


def parse_valor_br(s: str) -> float:
    """Converte 'R$ 1.000,00' ou ' R$ 1.000,00 ' em 1000.0"""
    if not s or not isinstance(s, str):
        return 0.0
    s = s.strip().replace("R$", "").strip()
    s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return 0.0


def main():
    import os
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Configure SUPABASE_URL e SUPABASE_KEY no .env")
        return 1

    if not CSV_PATH.exists():
        print(f"Arquivo não encontrado: {CSV_PATH}")
        return 1

    supabase = create_client(url, key)
    registros = []

    with open(CSV_PATH, "r", encoding="utf-8") as f:
        reader = csv.reader(f, delimiter=";")
        for i, row in enumerate(reader):
            if i == 0 and len(row) >= 2 and row[1].strip().upper() == "CPF":
                continue
            if len(row) < 3:
                continue
            nome = (row[0] or "").strip()
            cpf_raw = (row[1] or "").strip()
            cpf = apenas_numeros_cpf(cpf_raw)
            valor_ata = parse_valor_br(row[2] or "")
            if not nome or not cpf:
                continue
            registros.append({
                "empresa_id": EMPRESA_IRIS_ID,
                "nome": nome,
                "cpf": cpf,
                "valor_ata": round(valor_ata, 2),
            })

    if not registros:
        print("Nenhum registro válido no CSV.")
        return 1

    print(f"Encontrados {len(registros)} registros. Inserindo/atualizando...")
    supabase.table("dividendos_ata_2025").upsert(registros, on_conflict="empresa_id,cpf").execute()
    print("Concluído.")
    return 0


if __name__ == "__main__":
    exit(main())
