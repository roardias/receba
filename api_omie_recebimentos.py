"""
API Omie - ListarMovimentos (Recebimentos liquidados).
Funções reutilizáveis para listar recebimentos (Liquidado=S) com paginação.
Usado por: api_omie_movimentos - recebimentos.py (CSV) e sync_recebimentos_supabase.py.
"""
import time
import requests
from datetime import date, timedelta

ENDPOINT = "https://app.omie.com.br/api/v1/financas/mf/"
REGISTROS_POR_PAGINA = 500
MAX_TENTATIVAS = 5
ESPERA_ENTRE_TENTATIVAS = 30


def datas_pagto_recebimentos() -> tuple[str, str]:
    """dDtPagtoDe = hoje - 1 ano; dDtPagtoAte = hoje - 1 dia. Formato DD/MM/YYYY."""
    hoje = date.today()
    d_ate = hoje - timedelta(days=1)
    d_de = hoje - timedelta(days=365)
    return d_de.strftime("%d/%m/%Y"), d_ate.strftime("%d/%m/%Y")


def _chamar_api_com_retry(app_key: str, app_secret: str, pagina: int, d_dt_de: str, d_dt_ate: str) -> dict:
    """Chama ListarMovimentos (recebimentos) com retry."""
    payload = {
        "call": "ListarMovimentos",
        "param": [
            {
                "nPagina": pagina,
                "nRegPorPagina": REGISTROS_POR_PAGINA,
                "cNatureza": "R",
                "cTpLancamento": "CR",
                "lDadosCad": True,
                "cExibirDepartamentos": "N",
                "dDtPagtoDe": d_dt_de,
                "dDtPagtoAte": d_dt_ate,
            }
        ],
        "app_key": app_key,
        "app_secret": app_secret,
    }
    ultimo_erro = None
    for tentativa in range(1, MAX_TENTATIVAS + 1):
        try:
            resp = requests.post(
                ENDPOINT,
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=120,
            )
            if resp.status_code == 403:
                try:
                    msg_omie = resp.text.strip() or resp.reason
                except Exception:
                    msg_omie = resp.reason or "403"
                raise Exception(f"403 Omie (financas/mf): {msg_omie}")
            resp.raise_for_status()
            data = resp.json()
            if "faultstring" in data:
                raise Exception(f"Omie API: {data.get('faultstring', data)}")
            return data
        except Exception as e:
            ultimo_erro = e
            if tentativa < MAX_TENTATIVAS:
                time.sleep(ESPERA_ENTRE_TENTATIVAS)
    raise ultimo_erro


def _transformar_movimento(mov: dict, empresa: str) -> list[dict]:
    """Uma linha por movimento (Liquidado=S). Campos det_*, res_*, ValPago_validado."""
    detalhes = mov.get("detalhes") or mov.get("Detalhes") or {}
    resumo = mov.get("resumo") or mov.get("Resumo") or {}

    if isinstance(detalhes, list):
        detalhes = detalhes[0] if detalhes else {}
    if isinstance(resumo, list):
        resumo = resumo[0] if resumo else {}

    n_cod_titulo = detalhes.get("nCodTitulo") if isinstance(detalhes, dict) else None
    if n_cod_titulo is None:
        return []

    c_status = detalhes.get("cStatus") if isinstance(detalhes, dict) else ""
    if str(c_status).strip().upper() == "CANCELADO":
        return []

    c_liquidado = resumo.get("cLiquidado") if isinstance(resumo, dict) else ""
    if str(c_liquidado).strip().upper() != "S":
        return []

    def _safe(val):
        if val is None:
            return ""
        return str(val)

    row: dict = {"empresa": empresa}
    if isinstance(detalhes, dict):
        for k, v in detalhes.items():
            if k and isinstance(k, str):
                row[f"det_{k}"] = _safe(v)
    if isinstance(resumo, dict):
        for k, v in resumo.items():
            if k and isinstance(k, str):
                row[f"res_{k}"] = _safe(v)
    # API pode enviar nCodCliente no nível do movimento (fora de detalhes)
    if not row.get("det_nCodCliente") and isinstance(mov, dict):
        for key in ("nCodCliente", "nCodcliente", "ncodcliente"):
            if mov.get(key) is not None:
                row["det_nCodCliente"] = _safe(mov[key])
                break

    def _float(val, default=0.0):
        try:
            return float(str(val).replace(",", "."))
        except (ValueError, TypeError):
            return default

    det_valor = _float(row.get("det_nValorTitulo", "0"))
    res_val_pago = _float(row.get("res_nValPago", "0"))
    res_val_aberto = _float(row.get("res_nValAberto", "0"))
    row["valor_validado"] = round(det_valor, 5)
    row["ValPago_validado"] = round(res_val_pago, 5)
    row["ValAberto_validado"] = round(res_val_aberto, 5) if res_val_aberto != 0 else ""

    return [row]


def listar_recebimentos_paginado(
    app_key: str, app_secret: str, empresa_nome: str, verbose: bool = True
) -> tuple[list[dict], int]:
    """
    Lista todos os recebimentos (Liquidado=S) com paginação.
    Retorna (lista de linhas, total de páginas).
    """
    d_dt_de, d_dt_ate = datas_pagto_recebimentos()
    todos = []
    pagina = 1
    n_tot_paginas = 1

    while True:
        if verbose:
            print(f"  Página {pagina}...", end=" ", flush=True)
        data = _chamar_api_com_retry(app_key, app_secret, pagina, d_dt_de, d_dt_ate)
        n_tot_paginas = data.get("nTotPaginas", 1)
        if pagina == 1 and verbose:
            print(f"\n  >> Total de páginas (API): {n_tot_paginas} <<\n", flush=True)
        movimentos = data.get("movimentos", [])
        if isinstance(movimentos, dict):
            movimentos = [movimentos]
        if not isinstance(movimentos, list):
            movimentos = []

        for mov in movimentos:
            rows = _transformar_movimento(mov, empresa_nome)
            todos.extend(rows)

        if verbose:
            print(f"{len(movimentos)} registros (total: {len(todos)})", flush=True)
        if pagina >= n_tot_paginas:
            break
        pagina += 1
        time.sleep(1)

    return todos, pagina
