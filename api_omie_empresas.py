"""
API Omie - ListarEmpresas
Extrai todas as empresas do Omie com paginação.
Utiliza exemplo_empresas.csv para obter app_key e app_secret de cada tenant.
"""

import csv
import json
import os
import requests
from pathlib import Path

ENDPOINT = "https://app.omie.com.br/api/v1/geral/empresas/"
REGISTROS_POR_PAGINA = 100
CSV_EMPRESAS = "exemplo_empresas.csv"
PASTA_SAIDA = "output"
CSV_SAIDA = "empresas_omie.csv"


def ler_empresas_csv(caminho: str) -> list[dict]:
    """Lê o arquivo exemplo_empresas.csv e retorna lista de dicionários."""
    empresas = []
    with open(caminho, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if row.get("APP_KEY") and row.get("APP_SECRET"):
                empresas.append(row)
    return empresas


def listar_empresas_paginado(app_key: str, app_secret: str) -> list[dict]:
    """
    Chama ListarEmpresas com paginação até extrair todos os registros.
    """
    todas_empresas = []
    pagina = 1

    while True:
        payload = {
            "call": "ListarEmpresas",
            "param": [
                {
                    "pagina": pagina,
                    "registros_por_pagina": REGISTROS_POR_PAGINA,
                    "apenas_importado_api": "N"
                }
            ],
            "app_key": app_key,
            "app_secret": app_secret
        }

        response = requests.post(
            ENDPOINT,
            headers={"Content-type": "application/json"},
            json=payload
        )
        response.raise_for_status()
        data = response.json()

        # Verifica erro da API Omie
        if "faultstring" in data:
            raise Exception(f"Omie API error: {data.get('faultstring', data)}")

        # empresas_list_response (resposta no root)
        total_de_paginas = data.get("total_de_paginas", 1)
        empresas_cadastro = data.get("empresas_cadastro", [])

        # Normaliza para lista (API pode retornar objeto único quando há 1 registro)
        if isinstance(empresas_cadastro, dict):
            empresas_cadastro = [empresas_cadastro]
        if not isinstance(empresas_cadastro, list):
            empresas_cadastro = []

        todas_empresas.extend(empresas_cadastro)

        print(f"  Página {pagina}/{total_de_paginas} - {len(empresas_cadastro)} registros")

        if pagina >= total_de_paginas:
            break
        pagina += 1

    return todas_empresas


def extrair_cabecalhos(registros: list[dict]) -> list[str]:
    """Extrai todos os campos únicos dos registros para o CSV."""
    cabecalhos = set()
    for r in registros:
        cabecalhos.update(k for k in r.keys() if not isinstance(r.get(k), (dict, list)))
    return sorted(cabecalhos)


def salvar_csv(registros: list[dict], caminho: str, cabecalho_extra: list[str] | None = None):
    """Salva os registros em CSV."""
    if not registros:
        print("Nenhum registro para salvar.")
        return

    # Campos fixos no início (tenant)
    campos_fixos = cabecalho_extra or []
    campos_dados = extrair_cabecalhos(registros)
    cabecalhos = campos_fixos + [c for c in campos_dados if c not in campos_fixos]

    with open(caminho, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=cabecalhos, delimiter=";", extrasaction="ignore")
        writer.writeheader()
        for r in registros:
            row = {k: ("" if v is None else str(v)) for k, v in r.items()}
            writer.writerow(row)


def main():
    base = Path(__file__).parent
    csv_empresas = base / CSV_EMPRESAS

    if not csv_empresas.exists():
        print(f"Arquivo não encontrado: {csv_empresas}")
        return

    empresas_config = ler_empresas_csv(csv_empresas)
    print(f"Encontradas {len(empresas_config)} empresas no CSV.\n")

    os.makedirs(base / PASTA_SAIDA, exist_ok=True)

    todos_registros = []

    for i, cfg in enumerate(empresas_config, 1):
        app_key = cfg["APP_KEY"].strip()
        app_secret = cfg["APP_SECRET"].strip()
        empresa_nome = cfg.get("Empresa", cfg.get("APLICATIVO", f"Empresa_{i}")).strip()

        print(f"[{i}/{len(empresas_config)}] {empresa_nome}")

        try:
            empresas = listar_empresas_paginado(app_key, app_secret)
            for e in empresas:
                e["tenant_empresa"] = empresa_nome
            todos_registros.extend(empresas)
            print(f"  Total: {len(empresas)} empresas\n")
        except Exception as ex:
            print(f"  ERRO: {ex}\n")
            continue

    # Salva CSV consolidado
    arquivo_saida = base / PASTA_SAIDA / CSV_SAIDA
    salvar_csv(todos_registros, arquivo_saida, cabecalho_extra=["tenant_empresa"])
    print(f"Arquivo gerado: {arquivo_saida}")
    print(f"Total de registros: {len(todos_registros)}")


if __name__ == "__main__":
    main()
