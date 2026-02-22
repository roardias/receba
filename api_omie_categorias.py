"""
API Omie - ListarCategorias
Extrai todas as categorias do Omie com paginação.
Utiliza exemplo_empresas.csv para obter app_key e app_secret de cada tenant.
Saída em CSV para mapeamento dos campos da tabela categorias.
"""

import csv
import html
import os
import requests
from pathlib import Path

ENDPOINT = "https://app.omie.com.br/api/v1/geral/categorias/"
REGISTROS_POR_PAGINA = 50
CSV_EMPRESAS = "exemplo_empresas.csv"
PASTA_SAIDA = "output"
CSV_SAIDA = "categorias_omie.csv"

# Campos para tabela e importação
CAMPOS_SAIDA = [
    "chave_unica",
    "empresa",
    "codigo",
    "descricao",
    "conta_receita",
]


def _decodificar_html(s: str) -> str:
    """Converte entidades HTML (&amp;, &lt;, etc.) para caracteres."""
    if not s or not isinstance(s, str):
        return s
    return html.unescape(s)


def transformar_categoria(raw: dict, empresa: str) -> dict:
    """Transforma registro da API no formato para tabela categorias."""
    codigo = str(raw.get("codigo", ""))
    return {
        "chave_unica": f"{empresa}_{codigo}",
        "empresa": empresa,
        "codigo": codigo,
        "descricao": _decodificar_html(raw.get("descricao") or ""),
        "conta_receita": raw.get("conta_receita") or "",
    }


def ler_empresas_csv(caminho: str) -> list[dict]:
    """Lê o arquivo exemplo_empresas.csv e retorna lista de dicionários."""
    empresas = []
    with open(caminho, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if row.get("APP_KEY") and row.get("APP_SECRET"):
                empresas.append(row)
    return empresas


def listar_categorias_paginado(app_key: str, app_secret: str) -> list[dict]:
    """
    Chama ListarCategorias com paginação até extrair todos os registros.
    """
    todas = []
    pagina = 1

    while True:
        payload = {
            "call": "ListarCategorias",
            "param": [
                {
                    "pagina": pagina,
                    "registros_por_pagina": REGISTROS_POR_PAGINA,
                }
            ],
            "app_key": app_key,
            "app_secret": app_secret,
        }

        response = requests.post(
            ENDPOINT,
            headers={"Content-type": "application/json"},
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

        if "faultstring" in data:
            raise Exception(f"Omie API error: {data.get('faultstring', data)}")

        total_de_paginas = data.get("total_de_paginas", 1)
        categoria_cadastro = data.get("categoria_cadastro", [])

        if isinstance(categoria_cadastro, dict):
            categoria_cadastro = [categoria_cadastro]
        if not isinstance(categoria_cadastro, list):
            categoria_cadastro = []

        todas.extend(categoria_cadastro)

        print(f"  Página {pagina}/{total_de_paginas} - {len(categoria_cadastro)} registros")

        if pagina >= total_de_paginas:
            break
        pagina += 1

    return todas


def salvar_csv(registros: list[dict], caminho: str):
    """Salva os registros em CSV com os campos definidos."""
    if not registros:
        print("Nenhum registro para salvar.")
        return

    with open(caminho, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CAMPOS_SAIDA, delimiter=";", extrasaction="ignore")
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
            categorias_raw = listar_categorias_paginado(app_key, app_secret)
            categorias = [transformar_categoria(c, empresa_nome) for c in categorias_raw]
            todos_registros.extend(categorias)
            print(f"  Total: {len(categorias)} categorias\n")
        except Exception as ex:
            print(f"  ERRO: {ex}\n")
            continue

    arquivo_saida = base / PASTA_SAIDA / CSV_SAIDA
    salvar_csv(todos_registros, arquivo_saida)
    print(f"Arquivo gerado: {arquivo_saida}")
    print(f"Total de registros: {len(todos_registros)}")


if __name__ == "__main__":
    main()
