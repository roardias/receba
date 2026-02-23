"""
Sync Pagamentos Realizados - Omie API → Supabase
Filtro antes de importar: ValPago_validado > 0.
Logs em api_sync_log. Datas dDtPagtoDe/dDtPagtoAte via env (PAGAMENTOS_PAGTO_DE, PAGAMENTOS_PAGTO_ATE) ou padrão do script.
"""
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from api_omie_pagamentos_realizados import (
    listar_pagamentos_paginado,
    _datas_padrao_pagamento,
)
from api_omie_clientes import ler_empresas_csv

load_dotenv()

BATCH_SIZE = 100
CONFLICT_COLUMNS = "empresa,det_ncodtitulo,categ_validada,dept_cod,det_ncodcliente,det_ncodbaixa"
API_TIPO = "pagamentos_realizados"

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
    "det_ncodbaixa",
    "ValPago_validado",
    "ValAberto_validado",
)


def _normalizar_data_omie(s: str | None) -> str:
    """Garante data em DD/MM/AAAA para a API Omie. Aceita DD/MM/AAAA ou YYYY-MM-DD."""
    if not s or not str(s).strip():
        return ""
    s = str(s).strip()
    # YYYY-MM-DD (ex.: vindo do banco em outro formato)
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            y, m, d = s[:4], s[5:7], s[8:10]
            return f"{d}/{m}/{y}"
        except (ValueError, TypeError):
            pass
    # Já DD/MM/AAAA
    if "/" in s and len(s) >= 10:
        return s
    return s


def _apenas_numeros(val: str) -> str:
    if val is None or not isinstance(val, str):
        return ""
    return re.sub(r"[^0-9]", "", val)


def _parse_date(val) -> str | None:
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


def _val_pago_maior_zero(row: dict) -> bool:
    """Filtro: só importa se ValPago_validado > 0."""
    v = row.get("ValPago_validado")
    if v is None or v == "":
        return False
    try:
        return float(v) > 0
    except (ValueError, TypeError):
        return False


def transformar_para_tabela(row: dict) -> dict:
    """Mapeia row do API para colunas da tabela pagamentos_realizados (lowercase no PG)."""
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
        "det_ncodbaixa": str(row.get("det_nCodBaixa", "") or "").strip() or "",
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


def executar_sync_pagamentos_realizados_empresas(
    supabase,
    empresas: list[dict],
    label: str = "",
    dDtPagtoDe: str | None = None,
    dDtPagtoAte: str | None = None,
) -> int:
    """Executa sync de pagamentos realizados para lista de empresas (usado pelo scheduler).
    Datas para a API Omie (dDtPagtoDe, dDtPagtoAte em DD/MM/AAAA):
    1) Se o agendamento informou pagamentos_data_de e pagamentos_data_ate, usamos eles.
    2) Senão, variáveis de ambiente PAGAMENTOS_PAGTO_DE e PAGAMENTOS_PAGTO_ATE.
    3) Senão, padrão dinâmico: últimos 30 dias até ontem."""
    from scheduler_status import limpar_em_execucao, registrar_em_execucao

    prefix = f"  [{label}] " if label else "  "
    origem_datas = None
    if dDtPagtoDe and dDtPagtoAte:
        dDtPagtoDe = _normalizar_data_omie(dDtPagtoDe.strip())
        dDtPagtoAte = _normalizar_data_omie(dDtPagtoAte.strip())
        origem_datas = "agendamento"
    if not dDtPagtoDe or not dDtPagtoAte:
        dDtPagtoDe = os.getenv("PAGAMENTOS_PAGTO_DE", "").strip()
        dDtPagtoAte = os.getenv("PAGAMENTOS_PAGTO_ATE", "").strip()
        origem_datas = "env" if (dDtPagtoDe and dDtPagtoAte) else None
    if not dDtPagtoDe or not dDtPagtoAte:
        dDtPagtoDe, dDtPagtoAte = _datas_padrao_pagamento()
        origem_datas = "padrão (30 dias até ontem)"
    # Log no CMD: o que está indo para a Omie
    print(f"{prefix}[Pagamentos Realizados] Omie: dDtPagtoDe={dDtPagtoDe!r} dDtPagtoAte={dDtPagtoAte!r} (origem: {origem_datas})", flush=True)

    total = 0
    for emp in empresas:
        nome = emp["nome_curto"]
        app_key = emp["app_key"]
        app_secret = emp.get("app_secret") or ""
        print(f"{prefix}Pagamentos realizados {nome}...", end=" ", flush=True)
        registrar_em_execucao(supabase, nome, API_TIPO, label)
        try:
            registros_raw, _ = listar_pagamentos_paginado(
                app_key, app_secret, nome, dDtPagtoDe, dDtPagtoAte
            )
            # Transformar e filtrar: só ValPago_validado > 0
            todos = [transformar_para_tabela(r) for r in registros_raw]
            pagamentos = [r for r in todos if _val_pago_maior_zero(r)]
            if not pagamentos:
                print("0", flush=True)
                registrar_log(supabase, nome, "sucesso", 0)
                continue
            n = upsert_batch(supabase, pagamentos)
            registrar_log(supabase, nome, "sucesso", n)
            total += n
            print(n, flush=True)
        except Exception as e:
            print(f"ERRO: {e}", flush=True)
            registrar_log(supabase, nome, "erro", 0, str(e))
        finally:
            limpar_em_execucao(supabase)
    return total


def _chave_conflito(r: dict) -> tuple:
    """Chave usada no ON CONFLICT: empresa, det_ncodtitulo, categ_validada, dept_cod, det_ncodcliente, det_ncodbaixa."""
    return (
        r.get("empresa", "") or "",
        str(r.get("det_ncodtitulo", "") or ""),
        r.get("categ_validada", "") or "",
        r.get("dept_cod", "") or "",
        str(r.get("det_ncodcliente", "") or ""),
        str(r.get("det_ncodbaixa", "") or ""),
    )


def _registros_duplicados_no_lote(batch: list[dict]) -> list[dict]:
    """Retorna os registros do lote cuja chave de conflito aparece mais de uma vez (para log de erro)."""
    from collections import defaultdict
    por_chave = defaultdict(list)
    for r in batch:
        por_chave[_chave_conflito(r)].append(r)
    duplicados = []
    for registros in por_chave.values():
        if len(registros) > 1:
            duplicados.extend(registros)
    return duplicados


def upsert_batch(supabase, registros: list[dict]) -> int:
    total = 0
    for i in range(0, len(registros), BATCH_SIZE):
        batch = [
            {k: v for k, v in r.items() if k in COLUNAS_TABELA}
            for r in registros[i : i + BATCH_SIZE]
        ]
        try:
            supabase.table("pagamentos_realizados").upsert(batch, on_conflict=CONFLICT_COLUMNS).execute()
            total += len(batch)
        except Exception as e:
            err_msg = str(e)
            duplicados = _registros_duplicados_no_lote(batch)
            detalhe = [
                f"Erro no upsert: {err_msg}",
                f"Lote com {len(batch)} registro(s), índice do lote: {i} a {i + len(batch)}.",
            ]
            if duplicados:
                detalhe.append(
                    f"Registros com chave duplicada dentro do mesmo lote ({len(duplicados)}):"
                )
                for idx, r in enumerate(duplicados):
                    detalhe.append(f"  [{idx}] {r}")
            else:
                detalhe.append("Lote completo que falhou:")
                for idx, r in enumerate(batch):
                    detalhe.append(f"  [{idx}] {r}")
            msg_log = "\n".join(detalhe)
            print(msg_log, flush=True)
            raise ValueError(msg_log) from e
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

    dDtPagtoDe = os.getenv("PAGAMENTOS_PAGTO_DE", "").strip()
    dDtPagtoAte = os.getenv("PAGAMENTOS_PAGTO_ATE", "").strip()
    if not dDtPagtoDe or not dDtPagtoAte:
        dDtPagtoDe, dDtPagtoAte = _datas_padrao_pagamento()

    supabase = create_client(url, key)
    total_geral = 0

    for i, cfg in enumerate(empresas, 1):
        app_key = cfg["APP_KEY"].strip()
        app_secret = cfg["APP_SECRET"].strip()
        empresa_nome = cfg.get("Empresa", cfg.get("APLICATIVO", f"Empresa_{i}")).strip()

        print(f"[{i}/{len(empresas)}] {empresa_nome} (pagto {dDtPagtoDe} a {dDtPagtoAte})", end=" ")

        try:
            registros_raw, _ = listar_pagamentos_paginado(
                app_key, app_secret, empresa_nome, dDtPagtoDe, dDtPagtoAte
            )
            todos = [transformar_para_tabela(r) for r in registros_raw]
            pagamentos = [r for r in todos if _val_pago_maior_zero(r)]

            if not pagamentos:
                print("(0 com ValPago>0)")
                registrar_log(supabase, empresa_nome, "sucesso", 0)
                continue

            n = upsert_batch(supabase, pagamentos)
            total_geral += n
            registrar_log(supabase, empresa_nome, "sucesso", n)
            print(f"- {n} upsertados (ValPago>0)")
        except Exception as e:
            msg = str(e)
            registrar_log(supabase, empresa_nome, "erro", 0, msg)
            print(f"- ERRO: {e}")
            continue

    print(f"\nTotal processado: {total_geral} registros (ValPago_validado > 0)")
    try:
        supabase.rpc("refresh_view_concimed_pagamentos_realizados").execute()
        print("View Concimed (pagamentos realizados) atualizada.")
    except Exception as e:
        print(f"Aviso: refresh view Concimed: {e}")
    return 0


if __name__ == "__main__":
    exit(main())
