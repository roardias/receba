"""
Sync Movimentos Geral → titulos_pagos e titulos_a_vencer (Supabase).
Filtros antes do insert:
  titulos_pagos: res_cLiquidado = 'S', det_cGrupo = 'CONTA_A_RECEBER'
  titulos_a_vencer: res_cLiquidado = 'N', det_cGrupo = 'CONTA_A_RECEBER', det_dDtPrevisao > hoje
chave_empresa_cod_cliente = empresa & det_nCodCliente.
Sem CSV; mesma lógica de outras APIs (log em api_sync_log, empresas do scheduler).
"""

import os
import re
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from api_omie_movimentos_geral import listar_movimentos_geral

load_dotenv()

BATCH_SIZE = 100
API_TIPO = "movimentos_geral"

# Colunas das tabelas (PostgREST usa lowercase; "ValAberto_validado" fica com aspas no PG)
COLUNAS_PAGOS = (
    "empresa",
    "ValAberto_validado",
    "det_ccpfcnpjcliente",
    "categ_validada",
    "det_cnumdocfiscal",
    "det_ddtalt",
    "det_ddtprevisao",
    "det_ddtpagamento",
    "det_ncodtitulo",
    "chave_empresa_cod_cliente",
)
COLUNAS_AVENCER = COLUNAS_PAGOS


def _parse_date(val) -> str | None:
    """Converte para ISO date (YYYY-MM-DD) ou None."""
    if val is None or (isinstance(val, str) and not val.strip()):
        return None
    s = str(val).strip()
    if not s:
        return None
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        d, mon, y = m.groups()
        return f"{y}-{mon.zfill(2)}-{d.zfill(2)}"
    if re.match(r"\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None


def _parse_date_to_compare(val) -> date | None:
    """Para comparação com hoje. Retorna date ou None."""
    iso = _parse_date(val)
    if not iso:
        return None
    try:
        return date(int(iso[:4]), int(iso[5:7]), int(iso[8:10]))
    except (ValueError, TypeError):
        return None


def _row_para_tabela(row: dict) -> dict:
    """Mapeia row da API para colunas de titulos_pagos / titulos_a_vencer."""
    empresa = (row.get("empresa") or "").strip()
    cod_cliente = (row.get("det_nCodCliente") or "").strip()
    chave = f"{empresa}_{cod_cliente}" if empresa or cod_cliente else empresa or cod_cliente

    n_cod = row.get("det_nCodTitulo")
    if n_cod is not None and n_cod != "":
        try:
            det_nCodTitulo = int(float(str(n_cod).replace(",", ".")))
        except (ValueError, TypeError):
            det_nCodTitulo = None
    else:
        det_nCodTitulo = None

    val_aberto = row.get("ValAberto_validado")
    if val_aberto is None or val_aberto == "":
        ValAberto_validado = None
    else:
        try:
            ValAberto_validado = float(str(val_aberto).replace(",", "."))
        except (ValueError, TypeError):
            ValAberto_validado = None

    return {
        "empresa": empresa,
        "ValAberto_validado": ValAberto_validado,
        "det_ccpfcnpjcliente": (row.get("det_cCPFCNPJCliente") or "").strip(),
        "categ_validada": (row.get("categ_validada") or "").strip(),
        "det_cnumdocfiscal": (row.get("det_cNumDocFiscal") or "").strip(),
        "det_ddtalt": _parse_date(row.get("det_dDtAlt")),
        "det_ddtprevisao": _parse_date(row.get("det_dDtPrevisao")),
        "det_ddtpagamento": _parse_date(row.get("det_dDtPagamento")),
        "det_ncodtitulo": det_nCodTitulo,
        "chave_empresa_cod_cliente": chave,
    }


def _filtrar_titulos_pagos(registros: list[dict]) -> list[dict]:
    """res_cLiquidado = 'S' e det_cGrupo = 'CONTA_A_RECEBER'."""
    out = []
    for r in registros:
        liq = (r.get("res_cLiquidado") or "").strip().upper()
        grupo = (r.get("det_cGrupo") or "").strip().upper()
        if liq == "S" and grupo == "CONTA_A_RECEBER":
            out.append(r)
    return out


def _filtrar_titulos_a_vencer(registros: list[dict]) -> list[dict]:
    """res_cLiquidado = 'N', det_cGrupo = 'CONTA_A_RECEBER', det_dDtPrevisao > hoje."""
    hoje = date.today()
    out = []
    for r in registros:
        liq = (r.get("res_cLiquidado") or "").strip().upper()
        grupo = (r.get("det_cGrupo") or "").strip().upper()
        if liq != "N" or grupo != "CONTA_A_RECEBER":
            continue
        previsao = _parse_date_to_compare(r.get("det_dDtPrevisao"))
        if previsao is None:
            continue
        if previsao <= hoje:
            continue
        out.append(r)
    return out


def _dedupe_por_titulo(registros: list[dict]) -> list[dict]:
    """Um registro por (empresa, det_nCodTitulo); mantém o primeiro."""
    vistos = set()
    out = []
    for r in registros:
        empresa = (r.get("empresa") or "").strip()
        cod = (r.get("det_nCodTitulo") or "")
        key = (empresa, str(cod))
        if key in vistos:
            continue
        vistos.add(key)
        out.append(r)
    return out


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


def limpar_empresa(supabase, empresa_nome: str, tabela: str) -> None:
    supabase.table(tabela).delete().eq("empresa", empresa_nome).execute()


def insert_batch(supabase, tabela: str, colunas: tuple, registros: list[dict]) -> int:
    total = 0
    for i in range(0, len(registros), BATCH_SIZE):
        batch = [
            {k: v for k, v in r.items() if k in colunas}
            for r in registros[i : i + BATCH_SIZE]
        ]
        if not batch:
            continue
        supabase.table(tabela).insert(batch).execute()
        total += len(batch)
    return total


def executar_sync_titulos_pagos_a_vencer_empresas(supabase, empresas: list[dict], label: str = "") -> int:
    """Executa sync Movimentos Geral para lista de empresas (scheduler)."""
    from scheduler_status import limpar_em_execucao, registrar_em_execucao

    prefix = f"  [{label}] " if label else "  "
    total = 0
    for emp in empresas:
        nome = emp["nome_curto"]
        app_key = emp["app_key"]
        app_secret = emp.get("app_secret") or ""
        print(f"{prefix}Movimentos Geral {nome}...", end=" ", flush=True)
        registrar_em_execucao(supabase, nome, API_TIPO, label)
        try:
            registros_raw = listar_movimentos_geral(app_key, app_secret, nome, verbose=False)
            pagos_raw = _filtrar_titulos_pagos(registros_raw)
            a_vencer_raw = _filtrar_titulos_a_vencer(registros_raw)
            pagos_dedup = _dedupe_por_titulo(pagos_raw)
            a_vencer_dedup = _dedupe_por_titulo(a_vencer_raw)
            pagos = [_row_para_tabela(r) for r in pagos_dedup]
            a_vencer = [_row_para_tabela(r) for r in a_vencer_dedup]

            limpar_empresa(supabase, nome, "titulos_pagos")
            limpar_empresa(supabase, nome, "titulos_a_vencer")
            n_pagos = insert_batch(supabase, "titulos_pagos", COLUNAS_PAGOS, pagos) if pagos else 0
            n_avencer = insert_batch(supabase, "titulos_a_vencer", COLUNAS_AVENCER, a_vencer) if a_vencer else 0
            n = n_pagos + n_avencer
            registrar_log(supabase, nome, "sucesso", n)
            total += n
            print(f"pagos={n_pagos} a_vencer={n_avencer}", flush=True)
        except Exception as e:
            print(f"ERRO: {e}", flush=True)
            registrar_log(supabase, nome, "erro", 0, str(e))
        finally:
            limpar_em_execucao(supabase)
    return total


def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Configure SUPABASE_URL e SUPABASE_KEY no .env")
        return 1

    base = Path(__file__).parent
    csv_path = base / "exemplo_empresas.csv"
    if not csv_path.exists():
        print(f"Arquivo não encontrado: {csv_path}")
        return 1

    from api_omie_clientes import ler_empresas_csv
    empresas_csv = ler_empresas_csv(str(csv_path))
    if not empresas_csv:
        print("Nenhuma empresa com APP_KEY e APP_SECRET no CSV.")
        return 1

    supabase = create_client(url, key)
    empresas = []
    for cfg in empresas_csv:
        nome = (cfg.get("Empresa") or cfg.get("APLICATIVO") or "").strip()
        if not nome:
            continue
        app_key = (cfg.get("APP_KEY") or "").strip()
        app_secret = (cfg.get("APP_SECRET") or "").strip()
        if not app_key:
            continue
        empresas.append({"nome_curto": nome, "app_key": app_key, "app_secret": app_secret})

    if not empresas:
        print("Nenhuma empresa válida no CSV.")
        return 1

    total = executar_sync_titulos_pagos_a_vencer_empresas(supabase, empresas, label="")
    print(f"\nTotal: {total} registros (titulos_pagos + titulos_a_vencer)")
    return 0


if __name__ == "__main__":
    exit(main())
