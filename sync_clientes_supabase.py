"""
Sync Clientes - Omie API → Supabase
Execução diária recomendada (Supabase Cron ou agendador externo).

Fluxo UPSERT:
- Registro novo  → INSERT
- Registro existente → UPDATE (empresa + codigo_cliente_omie)
- Sempre traz dados frescos da API (atualizações de campos)

Logs: salva em api_sync_log (sucesso, erro, quantidade).
"""
import csv
import html
import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

ENDPOINT_OMIE = "https://app.omie.com.br/api/v1/geral/clientes/"
REGISTROS_POR_PAGINA = 50
CSV_EMPRESAS = "exemplo_empresas.csv"
BATCH_SIZE = 100
CONFLICT_COLUMNS = "empresa,codigo_cliente_omie"
API_TIPO = "clientes"

# Colunas aceitas pela tabela clientes
COLUNAS_CLIENTES = (
    "empresa", "cnpj_cpf", "codigo_cliente_omie", "email", "contato",
    "nome_fantasia", "razao_social", "telefone1", "telefone2",
)


def _normalizar_telefone(valor: str | None) -> str:
    if not valor:
        return ""
    return "".join(c for c in str(valor) if c.isdigit())


def _concat_telefone(ddd: str | None, numero: str | None) -> str:
    ddd = _normalizar_telefone(ddd)
    numero = _normalizar_telefone(numero)
    if not ddd and not numero:
        return ""
    return ddd + numero


def _decodificar_html(s: str) -> str:
    """Converte entidades HTML (&amp;, &lt;, etc.) para caracteres. Omie pode enviar &amp; em vez de &."""
    if not s or not isinstance(s, str):
        return s
    return html.unescape(s)


def _normalizar_cnpj_cpf(valor: str | None) -> str | None:
    """
    Extrai apenas dígitos do cnpj_cpf da API Omie.
    CNPJ (14 dígitos) e CPF (11 dígitos) preenchidos com zeros à esquerda.
    Retorna None se vazio.
    """
    if not valor:
        return None
    dig = "".join(c for c in str(valor) if c.isdigit())
    if not dig:
        return None
    if len(dig) >= 12:
        return dig[:14].zfill(14)  # CNPJ
    return dig.zfill(11)  # CPF


def transformar_cliente(raw: dict, empresa: str) -> dict:
    codigo = str(raw.get("codigo_cliente_omie", ""))
    # API Omie pode enviar cnpj_cpf formatado (ex: 000.000.000-00) - sempre normalizar
    valor_raw = raw.get("cnpj_cpf") or raw.get("CNPJ_CPF") or raw.get("cnpjCpf")
    cnpj_cpf = _normalizar_cnpj_cpf(valor_raw)
    return {
        "empresa": empresa,
        "cnpj_cpf": cnpj_cpf,
        "codigo_cliente_omie": codigo,
        "email": _decodificar_html(raw.get("email") or ""),
        "contato": _decodificar_html(raw.get("contato") or ""),
        "nome_fantasia": _decodificar_html(raw.get("nome_fantasia") or ""),
        "razao_social": _decodificar_html(raw.get("razao_social") or ""),
        "telefone1": _concat_telefone(raw.get("telefone1_ddd"), raw.get("telefone1_numero")),
        "telefone2": _concat_telefone(raw.get("telefone2_ddd"), raw.get("telefone2_numero")),
    }


def registrar_log(supabase, empresa_nome: str, status: str, registros: int = 0, mensagem_erro: str | None = None):
    agora = datetime.now(timezone.utc).isoformat()
    supabase.table("api_sync_log").insert({
        "empresa_nome": empresa_nome,
        "api_tipo": API_TIPO,
        "iniciado_em": agora,
        "finalizado_em": agora,
        "status": status,
        "registros_processados": registros,
        "mensagem_erro": mensagem_erro,
    }).execute()


def ler_empresas_csv(caminho: Path) -> list[dict]:
    empresas = []
    with open(caminho, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if row.get("APP_KEY") and row.get("APP_SECRET"):
                empresas.append(row)
    return empresas


def listar_clientes_omie_completo(app_key: str, app_secret: str) -> list[dict]:
    todos = []
    pagina = 1

    while True:
        payload = {
            "call": "ListarClientes",
            "param": [
                {
                    "pagina": pagina,
                    "registros_por_pagina": REGISTROS_POR_PAGINA,
                    "apenas_importado_api": "N",
                }
            ],
            "app_key": app_key,
            "app_secret": app_secret,
        }
        resp = requests.post(
            ENDPOINT_OMIE,
            headers={"Content-type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        if "faultstring" in data:
            raise Exception(f"Omie API: {data.get('faultstring')}")

        total_paginas = data.get("total_de_paginas", 1)
        cadastros = data.get("clientes_cadastro", [])
        if isinstance(cadastros, dict):
            cadastros = [cadastros]
        if not isinstance(cadastros, list):
            cadastros = []

        todos.extend(cadastros)
        if pagina >= total_paginas:
            break
        pagina += 1

    return todos


def upsert_batch(supabase, clientes: list[dict]) -> int:
    total = 0
    for i in range(0, len(clientes), BATCH_SIZE):
        batch = []
        for c in clientes[i : i + BATCH_SIZE]:
            row = {k: v for k, v in c.items() if k in COLUNAS_CLIENTES}
            # Garantir cnpj_cpf só dígitos (ex: 000.000.000-00 -> 00000000000)
            if "cnpj_cpf" in row and row["cnpj_cpf"]:
                norm = _normalizar_cnpj_cpf(row["cnpj_cpf"])
                row["cnpj_cpf"] = norm  # None se vazio (NULL no banco)
            batch.append(row)
        supabase.table("clientes").upsert(
            batch,
            on_conflict=CONFLICT_COLUMNS,
        ).execute()
        total += len(batch)
    return total


def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Configure SUPABASE_URL e SUPABASE_KEY no .env")
        return 1

    base = Path(__file__).parent
    csv_path = base / CSV_EMPRESAS
    if not csv_path.exists():
        print(f"Arquivo não encontrado: {csv_path}")
        return 1

    empresas = ler_empresas_csv(csv_path)
    if not empresas:
        print("Nenhuma empresa no CSV.")
        return 1

    supabase = create_client(url, key)
    total_geral = 0

    for i, cfg in enumerate(empresas, 1):
        app_key = cfg["APP_KEY"].strip()
        app_secret = cfg["APP_SECRET"].strip()
        empresa_nome = cfg.get("Empresa", cfg.get("APLICATIVO", f"Empresa_{i}")).strip()

        print(f"[{i}/{len(empresas)}] {empresa_nome}", end=" ")

        try:
            clientes_raw = listar_clientes_omie_completo(app_key, app_secret)
            clientes = [transformar_cliente(c, empresa_nome) for c in clientes_raw]

            if not clientes:
                print("(0 clientes)")
                registrar_log(supabase, empresa_nome, "sucesso", 0)
                continue

            n = upsert_batch(supabase, clientes)
            total_geral += n
            registrar_log(supabase, empresa_nome, "sucesso", n)
            print(f"- {n} upsertados")
        except Exception as e:
            msg = str(e)
            registrar_log(supabase, empresa_nome, "erro", 0, msg)
            print(f"- ERRO: {e}")
            continue

    print(f"\nTotal processado: {total_geral} registros")
    return 0


if __name__ == "__main__":
    exit(main())
