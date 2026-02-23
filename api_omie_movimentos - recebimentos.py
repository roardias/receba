"""
API Omie - ListarMovimentos (Movimento Financeiro - Recebimentos)
Extrai movimentos financeiros (recebimentos liquidados) com paginação.
Script para UMA empresa (API pesada). Saída em CSV.
"""
import csv
import os
from pathlib import Path

from api_omie_recebimentos import (
    ESPERA_ENTRE_TENTATIVAS,
    MAX_TENTATIVAS,
    datas_pagto_recebimentos,
    listar_recebimentos_paginado,
)

CSV_EMPRESAS = "exemplo_empresas.csv"
PASTA_SAIDA = "output"
CSV_SAIDA = "movimentos_financeiros_omie.csv"
EMPRESA_FILTRO = "Alldax 3"


def ler_empresas_csv(caminho: str) -> list[dict]:
    """Lê o arquivo exemplo_empresas.csv e retorna lista de dicionários."""
    empresas = []
    with open(caminho, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if row.get("APP_KEY") and row.get("APP_SECRET"):
                empresas.append(row)
    return empresas


def main():
    base = Path(__file__).parent
    csv_empresas = base / CSV_EMPRESAS

    if not csv_empresas.exists():
        print(f"Arquivo não encontrado: {csv_empresas}")
        return 1

    empresas_config = ler_empresas_csv(csv_empresas)
    if not empresas_config:
        print("Nenhuma empresa com APP_KEY e APP_SECRET no CSV.")
        return 1

    filtro = (EMPRESA_FILTRO or "").strip()
    cfg = None
    for c in empresas_config:
        nome = (c.get("Empresa") or c.get("APLICATIVO") or "").strip()
        if nome and filtro and nome.lower() == filtro.lower():
            cfg = c
            break
    if cfg is None and empresas_config:
        cfg = empresas_config[0]
        print(f"Aviso: '{EMPRESA_FILTRO}' não encontrado no CSV. Usando: {cfg.get('Empresa', cfg.get('APLICATIVO', '?'))}\n")
    if cfg is None:
        print("Nenhuma empresa disponível.")
        return 1
    app_key = cfg["APP_KEY"].strip()
    app_secret = cfg["APP_SECRET"].strip()
    empresa_nome = cfg.get("Empresa", cfg.get("APLICATIVO", "Empresa_1")).strip()

    d_de, d_ate = datas_pagto_recebimentos()
    print(f"Movimentos Financeiros (recebimentos) - {empresa_nome}")
    print(f"Período pagamento: {d_de} a {d_ate} (dDtPagtoDe / dDtPagtoAte)")
    print(f"Retry: {MAX_TENTATIVAS}x com {ESPERA_ENTRE_TENTATIVAS}s entre falhas\n")

    os.makedirs(base / PASTA_SAIDA, exist_ok=True)

    try:
        registros, _ = listar_recebimentos_paginado(app_key, app_secret, empresa_nome, verbose=True)
    except Exception as e:
        print(f"\nERRO: {e}")
        return 1

    if not registros:
        print("\nNenhum registro para salvar.")
        return 0

    # Unir todas as chaves para capturar colunas que aparecem em alguns registros só
    todos_campos = set()
    for r in registros:
        todos_campos.update(r.keys())
    campos = ["empresa"] + sorted(k for k in todos_campos if k != "empresa")
    arquivo_saida = base / PASTA_SAIDA / CSV_SAIDA

    with open(arquivo_saida, "w", encoding="utf-8-sig", newline="", errors="replace") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=campos,
            delimiter=";",
            extrasaction="ignore",
            quoting=csv.QUOTE_NONNUMERIC,
        )
        writer.writeheader()
        for r in registros:
            row = {}
            for k, v in r.items():
                if v is None or v == "":
                    row[k] = ""
                else:
                    s = str(v)
                    row[k] = s.replace("\r", " ").replace("\n", " ")  # Evita quebra de linha no CSV
            writer.writerow(row)

    print(f"\nArquivo gerado: {arquivo_saida}")
    print(f"Total de {len(registros)} registro(s).")
    return 0


if __name__ == "__main__":
    exit(main())
