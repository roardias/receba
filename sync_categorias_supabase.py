"""
Sync Categorias - Omie API → Supabase
Fluxo UPSERT por (empresa, codigo). Logs em api_sync_log.
"""
import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from supabase import create_client

from api_omie_categorias import (
    CAMPOS_SAIDA,
    transformar_categoria,
    listar_categorias_paginado,
)
from api_omie_clientes import ler_empresas_csv

load_dotenv()

REGISTROS_POR_PAGINA = 50
CSV_EMPRESAS = "exemplo_empresas.csv"
BATCH_SIZE = 100
CONFLICT_COLUMNS = "empresa,codigo"
API_TIPO = "categorias"


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


def executar_sync_categorias_empresas(supabase, empresas: list[dict], label: str = "") -> int:
    """Executa sync de categorias para lista de empresas (usado pelo scheduler)."""
    from scheduler_status import limpar_em_execucao, registrar_em_execucao

    total = 0
    prefix = f"  [{label}] " if label else "  "
    for emp in empresas:
        nome = emp["nome_curto"]
        app_key = emp["app_key"]
        app_secret = emp.get("app_secret") or ""
        print(f"{prefix}Categorias {nome}...", end=" ", flush=True)
        registrar_em_execucao(supabase, nome, "categorias", label)
        try:
            categorias_raw = listar_categorias_paginado(app_key, app_secret)
            categorias = [transformar_categoria(c, nome) for c in categorias_raw]
            if not categorias:
                print("0", flush=True)
                registrar_log(supabase, nome, "sucesso", 0)
                continue
            n = upsert_batch(supabase, categorias)
            registrar_log(supabase, nome, "sucesso", n)
            total += n
            print(n, flush=True)
        except Exception as e:
            print(f"ERRO: {e}", flush=True)
            registrar_log(supabase, nome, "erro", 0, str(e))
        finally:
            limpar_em_execucao(supabase)
    return total


def upsert_batch(supabase, categorias: list[dict]) -> int:
    total = 0
    colunas = ("empresa", "codigo", "descricao", "conta_receita")
    for i in range(0, len(categorias), BATCH_SIZE):
        batch = [
            {k: v for k, v in c.items() if k in colunas}
            for c in categorias[i : i + BATCH_SIZE]
        ]
        supabase.table("categorias").upsert(
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

    empresas = ler_empresas_csv(str(csv_path))
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
            categorias_raw = listar_categorias_paginado(app_key, app_secret)
            categorias = [transformar_categoria(c, empresa_nome) for c in categorias_raw]

            if not categorias:
                print("(0 categorias)")
                registrar_log(supabase, empresa_nome, "sucesso", 0)
                continue

            n = upsert_batch(supabase, categorias)
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
