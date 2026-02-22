"""
API Omie - ListarClientes
Extrai todos os clientes do Omie com paginação.
Utiliza exemplo_empresas.csv para obter app_key e app_secret de cada tenant.
"""

import csv
import html
import os
import requests
from pathlib import Path

ENDPOINT = "https://app.omie.com.br/api/v1/geral/clientes/"
REGISTROS_POR_PAGINA = 50
CSV_EMPRESAS = "exemplo_empresas.csv"
PASTA_SAIDA = "output"
CSV_SAIDA = "clientes_omie.csv"

# Campos definidos para o sistema (mapeamento)
CAMPOS_SAIDA = [
    "chave_unica",
    "empresa",
    "cnpj_cpf",
    "codigo_cliente_omie",
    "email",
    "contato",
    "nome_fantasia",
    "razao_social",
    "telefone1",
    "telefone2",
]


def _decodificar_html(s: str) -> str:
    """Converte entidades HTML (&amp;, &lt;, etc.) para caracteres."""
    if not s or not isinstance(s, str):
        return s
    return html.unescape(s)


def _normalizar_telefone(valor: str | None) -> str:
    """Retorna apenas dígitos. Remove espaços e caracteres especiais."""
    if not valor:
        return ""
    return "".join(c for c in str(valor) if c.isdigit())


def _normalizar_cnpj_cpf(valor: str | None) -> str | None:
    """Extrai apenas dígitos. CNPJ 14 dígitos, CPF 11 (zeros à esquerda). None se vazio."""
    if not valor:
        return None
    dig = "".join(c for c in str(valor) if c.isdigit())
    if not dig:
        return None
    if len(dig) >= 12:
        return dig[:14].zfill(14)
    return dig.zfill(11)


def _concat_telefone(ddd: str | None, numero: str | None) -> str:
    """Concatena DDD + número. Retorna apenas dígitos (sem espaços ou caracteres especiais)."""
    ddd = _normalizar_telefone(ddd)
    numero = _normalizar_telefone(numero)
    if not ddd and not numero:
        return ""
    return ddd + numero


def transformar_cliente(raw: dict, empresa: str) -> dict:
    """Transforma registro da API no formato definido para o sistema."""
    codigo = str(raw.get("codigo_cliente_omie", ""))
    cnpj_cpf = _normalizar_cnpj_cpf(raw.get("cnpj_cpf"))
    return {
        "chave_unica": f"{empresa}_{codigo}",
        "empresa": empresa,
        "cnpj_cpf": cnpj_cpf,
        "codigo_cliente_omie": codigo,
        "email": _decodificar_html(raw.get("email") or ""),
        "contato": _decodificar_html(raw.get("contato") or ""),
        "nome_fantasia": _decodificar_html(raw.get("nome_fantasia") or ""),
        "razao_social": _decodificar_html(raw.get("razao_social") or ""),
        "telefone1": _concat_telefone(
            raw.get("telefone1_ddd"),
            raw.get("telefone1_numero")
        ),
        "telefone2": _concat_telefone(
            raw.get("telefone2_ddd"),
            raw.get("telefone2_numero")
        ),
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


def listar_clientes_paginado(app_key: str, app_secret: str) -> list[dict]:
    """
    Chama ListarClientes com paginação até extrair todos os registros.
    """
    todos_clientes = []
    pagina = 1

    while True:
        payload = {
            "call": "ListarClientes",
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

        # clientes_listfull_response (resposta no root)
        total_de_paginas = data.get("total_de_paginas", 1)
        clientes_cadastro = data.get("clientes_cadastro", [])

        # Normaliza para lista (API pode retornar objeto único quando há 1 registro)
        if isinstance(clientes_cadastro, dict):
            clientes_cadastro = [clientes_cadastro]
        if not isinstance(clientes_cadastro, list):
            clientes_cadastro = []

        todos_clientes.extend(clientes_cadastro)

        print(f"  Página {pagina}/{total_de_paginas} - {len(clientes_cadastro)} registros")

        if pagina >= total_de_paginas:
            break
        pagina += 1

    return todos_clientes


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
            clientes_raw = listar_clientes_paginado(app_key, app_secret)
            clientes = [transformar_cliente(c, empresa_nome) for c in clientes_raw]
            todos_registros.extend(clientes)
            print(f"  Total: {len(clientes)} clientes\n")
        except Exception as ex:
            print(f"  ERRO: {ex}\n")
            continue

    # Salva CSV consolidado (apenas campos definidos)
    arquivo_saida = base / PASTA_SAIDA / CSV_SAIDA
    salvar_csv(todos_registros, arquivo_saida)
    print(f"Arquivo gerado: {arquivo_saida}")
    print(f"Total de registros: {len(todos_registros)}")


if __name__ == "__main__":
    main()
