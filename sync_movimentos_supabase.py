"""
Sync Movimentos (Contas a Receber) - Omie API → Supabase
Fluxo UPSERT por chave_unica. Logs em api_sync_log.
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from api_omie_movimentos import listar_movimentos_paginado
from api_omie_clientes import ler_empresas_csv

load_dotenv()

BATCH_SIZE = 100
# Constraint única: empresa + titulo + categ + dept (lowercase no PG)
CONFLICT_COLUMNS = "empresa,det_ncodtitulo,categ_validada,dept_cod"
API_TIPO = "movimento_financeiro"

COLUNAS_TABELA = (
    "empresa",
    "categ_validada",
    "dept_cod",
    "det_cnpj_cpf_apenas_numeros",
    "det_cnumdocfiscal",
    "det_ddtemissao",
    "det_ddtpagamento",
    "det_ddtprevisao",
    "det_ncodcliente",
    "det_ncodtitulo",
    "ValPago_validado",
    "ValAberto_validado",
)


def _apenas_numeros(val: str) -> str:
    """Extrai somente dígitos."""
    if val is None or not isinstance(val, str):
        return ""
    return re.sub(r"[^0-9]", "", val)


def _parse_date(val) -> str | None:
    """Converte para ISO date (YYYY-MM-DD) ou None."""
    if val is None or (isinstance(val, str) and not val.strip()):
        return None
    s = str(val).strip()
    if not s:
        return None
    # dd/mm/yyyy
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        d, mon, y = m.groups()
        return f"{y}-{mon.zfill(2)}-{d.zfill(2)}"
    # yyyy-mm-dd
    if re.match(r"\d{4}-\d{2}-\d{2}", s):
        return s[:10]
    return None


def transformar_movimento_para_tabela(row: dict) -> dict:
    """Mapeia row do API/CSV para colunas da tabela movimentos (lowercase no PG)."""
    cnpj_cpf = row.get("det_cCPFCNPJCliente", "")
    return {
        "empresa": row.get("empresa", ""),
        "categ_validada": row.get("categ_validada", ""),
        "dept_cod": row.get("dept_cod", ""),
        "det_cnpj_cpf_apenas_numeros": _apenas_numeros(cnpj_cpf),
        "det_cnumdocfiscal": row.get("det_cNumDocFiscal") or "",
        "det_ddtemissao": _parse_date(row.get("det_dDtEmissao")),
        "det_ddtpagamento": _parse_date(row.get("det_dDtPagamento")),
        "det_ddtprevisao": _parse_date(row.get("det_dDtPrevisao")),
        "det_ncodcliente": row.get("det_nCodCliente") or "",
        "det_ncodtitulo": row.get("det_nCodTitulo", ""),
        "ValPago_validado": row.get("ValPago_validado"),
        "ValAberto_validado": row.get("ValAberto_validado") if row.get("ValAberto_validado") != "" else None,
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


def executar_sync_movimentos_empresas(supabase, empresas: list[dict], label: str = "") -> int:
    """Executa sync de movimentos para lista de empresas (usado pelo scheduler)."""
    from scheduler_status import limpar_em_execucao, registrar_em_execucao

    total = 0
    prefix = f"  [{label}] " if label else "  "
    for emp in empresas:
        nome = emp["nome_curto"]
        app_key = emp["app_key"]
        app_secret = emp.get("app_secret") or ""
        print(f"{prefix}Movimentos {nome}...", end=" ", flush=True)
        registrar_em_execucao(supabase, nome, API_TIPO, label)
        try:
            registros_raw, _ = listar_movimentos_paginado(app_key, app_secret, nome)
            movimentos = [transformar_movimento_para_tabela(r) for r in registros_raw]
            if not movimentos:
                print("0", flush=True)
                registrar_log(supabase, nome, "sucesso", 0)
                continue
            n = upsert_batch(supabase, movimentos)
            registrar_log(supabase, nome, "sucesso", n)
            total += n
            print(n, flush=True)
        except Exception as e:
            print(f"ERRO: {e}", flush=True)
            registrar_log(supabase, nome, "erro", 0, str(e))
        finally:
            limpar_em_execucao(supabase)
    return total


def upsert_batch(supabase, movimentos: list[dict]) -> int:
    total = 0
    for i in range(0, len(movimentos), BATCH_SIZE):
        batch = [
            {k: v for k, v in m.items() if k in COLUNAS_TABELA}
            for m in movimentos[i : i + BATCH_SIZE]
        ]
        supabase.table("movimentos").upsert(batch, on_conflict=CONFLICT_COLUMNS).execute()
        total += len(batch)
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
            registros_raw, _ = listar_movimentos_paginado(app_key, app_secret, empresa_nome)
            movimentos = [transformar_movimento_para_tabela(r) for r in registros_raw]

            if not movimentos:
                print("(0 movimentos)")
                registrar_log(supabase, empresa_nome, "sucesso", 0)
                continue

            n = upsert_batch(supabase, movimentos)
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
