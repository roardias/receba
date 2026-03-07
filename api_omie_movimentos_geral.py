"""
API Omie - ListarMovimentos (Movimento Financeiro Geral)
Retorna movimentos com paginação para uso pelo sync titulos_pagos / titulos_a_vencer.
Sem CSV; dDtAltAte = data de hoje (variável).
"""

import time
from datetime import date

import requests

ENDPOINT = "https://app.omie.com.br/api/v1/financas/mf/"
REGISTROS_POR_PAGINA = 500
MAX_TENTATIVAS = 5
ESPERA_ENTRE_TENTATIVAS = 30


def _hoje_omie() -> str:
    """Data de hoje no formato DD/MM/AAAA para a API Omie."""
    d = date.today()
    return d.strftime("%d/%m/%Y")


def _chamar_api_com_retry(app_key: str, app_secret: str, pagina: int, verbose: bool = True) -> dict:
    d_ate = _hoje_omie()
    payload = {
        "call": "ListarMovimentos",
        "param": [
            {
                "nPagina": pagina,
                "nRegPorPagina": REGISTROS_POR_PAGINA,
                "lDadosCad": True,
                "cExibirDepartamentos": "S",
                "dDtAltDe": "01/01/2000",
                "dDtAltAte": d_ate,
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
            resp.raise_for_status()
            data = resp.json()
            if "faultstring" in data:
                raise Exception(f"Omie API: {data.get('faultstring', data)}")
            return data
        except Exception as e:
            ultimo_erro = e
            if verbose:
                print(f"    Tentativa {tentativa}/{MAX_TENTATIVAS} falhou: {e}", flush=True)
            if tentativa < MAX_TENTATIVAS:
                if verbose:
                    print(f"    Aguardando {ESPERA_ENTRE_TENTATIVAS}s...", flush=True)
                time.sleep(ESPERA_ENTRE_TENTATIVAS)
    raise ultimo_erro


def _transformar_movimento(mov: dict, empresa: str) -> list[dict]:
    """Extrai campos do movimento. Descarta CANCELADO. Produto cartesiano categ x dept."""
    detalhes = mov.get("detalhes") or mov.get("Detalhes") or {}
    resumo = mov.get("resumo") or mov.get("Resumo") or {}
    departamentos = mov.get("departamentos") or mov.get("Departamentos") or []
    categorias = mov.get("categorias") or mov.get("Categorias") or []

    if isinstance(detalhes, list):
        detalhes = detalhes[0] if detalhes else {}
    if isinstance(resumo, list):
        resumo = resumo[0] if resumo else {}
    if not isinstance(departamentos, list):
        departamentos = [departamentos] if departamentos else []
    if not isinstance(categorias, list):
        categorias = [categorias] if categorias else []

    departamentos = [d for d in departamentos if isinstance(d, dict)]
    categorias = [c for c in categorias if isinstance(c, dict)]

    c_status = detalhes.get("cStatus") if isinstance(detalhes, dict) else ""
    if str(c_status).strip().upper() == "CANCELADO":
        return []

    def _safe(val):
        if val is None:
            return ""
        return str(val)

    base: dict = {"empresa": empresa}
    if isinstance(detalhes, dict):
        for k, v in detalhes.items():
            if k and isinstance(k, str):
                base[f"det_{k}"] = _safe(v)
    if isinstance(resumo, dict):
        for k, v in resumo.items():
            if k and isinstance(k, str):
                base[f"res_{k}"] = _safe(v)

    lista_categ = categorias if categorias else [None]
    lista_dept = departamentos if departamentos else [None]
    rows = []

    for c in lista_categ:
        for d in lista_dept:
            row = dict(base)
            if c is not None:
                row["categ_cod"] = _safe(c.get("cCodCateg"))
                raw_categ = c.get("nDistrPercentual")
                if raw_categ is not None and str(raw_categ).strip():
                    try:
                        row["categ_pct"] = str(round(float(str(raw_categ).replace(",", ".")) / 100, 6))
                    except (ValueError, TypeError):
                        row["categ_pct"] = "1"
                else:
                    row["categ_pct"] = "1"
                row["categ_valor"] = _safe(c.get("nDistrValor"))
                row["categ_fixo"] = _safe(c.get("nValorFixo"))
            else:
                row["categ_cod"] = row["categ_valor"] = row["categ_fixo"] = ""
                row["categ_pct"] = "1"
            if d is not None:
                row["dept_cod"] = _safe(d.get("cCodDepartamento"))
                raw_dept = d.get("nDistrPercentual")
                if raw_dept is not None and str(raw_dept).strip():
                    try:
                        row["dept_pct"] = str(round(float(str(raw_dept).replace(",", ".")) / 100, 6))
                    except (ValueError, TypeError):
                        row["dept_pct"] = "1"
                else:
                    row["dept_pct"] = "1"
                row["dept_valor"] = _safe(d.get("nDistrValor"))
                row["dept_fixo"] = _safe(d.get("nValorFixo"))
            else:
                row["dept_cod"] = row["dept_valor"] = row["dept_fixo"] = ""
                row["dept_pct"] = "1"

            categ_cod_val = row.get("categ_cod", "").strip()
            det_cod = row.get("det_cCodCateg", "").strip()
            row["categ_validada"] = categ_cod_val if categ_cod_val else det_cod

            def _float(val, default=0.0):
                try:
                    return float(str(val).replace(",", "."))
                except (ValueError, TypeError):
                    return default

            categ_pct_dec = _float(row.get("categ_pct", "1"), 1.0)
            dept_pct_dec = _float(row.get("dept_pct", "1"), 1.0)
            det_valor = _float(row.get("det_nValorTitulo", "0"))
            res_val_pago = _float(row.get("res_nValPago", "0"))
            res_val_aberto = _float(row.get("res_nValAberto", "0"))
            row["valor_validado"] = round(det_valor * categ_pct_dec * dept_pct_dec, 5)
            row["ValPago_validado"] = round(res_val_pago * categ_pct_dec * dept_pct_dec, 5)
            row["ValAberto_validado"] = (
                round(res_val_aberto * categ_pct_dec * dept_pct_dec, 5)
                if res_val_aberto != 0
                else ""
            )
            rows.append(row)
    return rows


def listar_movimentos_geral(
    app_key: str, app_secret: str, empresa_nome: str, verbose: bool = True
) -> list[dict]:
    """
    Chama ListarMovimentos com paginação até extrair todos os registros.
    dDtAltAte = data de hoje. Retorna lista de dicts (uma linha por categ x dept por movimento).
    """
    todos = []
    pagina = 1
    n_tot_paginas = 1

    while True:
        if verbose:
            print(f"  Página {pagina}...", end=" ", flush=True)
        data = _chamar_api_com_retry(app_key, app_secret, pagina, verbose=verbose)
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

    if verbose:
        print(f"\nTotal de páginas: {pagina}", flush=True)
    return todos
