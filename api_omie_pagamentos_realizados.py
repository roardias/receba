"""
API Omie - Pagamentos Realizados (ListarMovimentos - Movimento Financeiro)
Extrai pagamentos realizados com paginação.

Parâmetros enviados ao Omie (ListarMovimentos):
  call: "ListarMovimentos"
  param[0]:
    nPagina, nRegPorPagina (500),
    cNatureza: "P" (Pagamento),
    cTpLancamento: "BXCP" (Baixa por pagamento),
    lDadosCad: True,
    cExibirDepartamentos: "S",
    dDtPagtoDe: data inicial de pagamento (DD/MM/AAAA),
    dDtPagtoAte: data final de pagamento (DD/MM/AAAA).
  app_key, app_secret

As datas dDtPagtoDe e dDtPagtoAte vêm do agendamento (pagamentos_data_de, pagamentos_data_ate)
ou de variáveis de ambiente PAGAMENTOS_PAGTO_DE / PAGAMENTOS_PAGTO_ATE, ou padrão dinâmico (últimos 30 dias).
"""

import argparse
import csv
import os
import time
from datetime import date, timedelta
from pathlib import Path

import requests

ENDPOINT = "https://app.omie.com.br/api/v1/financas/mf/"
REGISTROS_POR_PAGINA = 500
MAX_TENTATIVAS = 5
ESPERA_ENTRE_TENTATIVAS = 30
CSV_EMPRESAS = "exemplo_empresas.csv"
PASTA_SAIDA = "output"
CSV_SAIDA = "pagamentos_realizados_omie.csv"


def _datas_padrao_pagamento() -> tuple[str, str]:
    """Retorna (dDtPagtoDe, dDtPagtoAte) em DD/MM/AAAA: últimos 30 dias até ontem."""
    hoje = date.today()
    ate = hoje - timedelta(days=1)
    de = ate - timedelta(days=29)
    return de.strftime("%d/%m/%Y"), ate.strftime("%d/%m/%Y")


# Para uso em linha de comando (--pagto-de/--pagto-ate); sync usa agendamento ou _datas_padrao_pagamento()
DATA_PAGTO_DE_PADRAO, DATA_PAGTO_ATE_PADRAO = _datas_padrao_pagamento()


def ler_empresas_csv(caminho: str) -> list[dict]:
    """Lê o arquivo exemplo_empresas.csv e retorna lista de dicionários."""
    empresas = []
    with open(caminho, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            if row.get("APP_KEY") and row.get("APP_SECRET"):
                empresas.append(row)
    return empresas


def _chamar_api_com_retry(
    app_key: str,
    app_secret: str,
    pagina: int,
    dDtPagtoDe: str,
    dDtPagtoAte: str,
) -> dict:
    """Chama a API com retry (teimosinha): até 5 tentativas, 30s entre cada."""
    payload = {
        "call": "ListarMovimentos",
        "param": [
            {
                "nPagina": pagina,
                "nRegPorPagina": REGISTROS_POR_PAGINA,
                "cNatureza": "P",
                "cTpLancamento": "BXCP",
                "lDadosCad": True,
                "cExibirDepartamentos": "S",
                "dDtPagtoDe": dDtPagtoDe,
                "dDtPagtoAte": dDtPagtoAte,
            }
        ],
        "app_key": app_key,
        "app_secret": app_secret,
    }

    # Log: exatamente o que está indo para a Omie (aparece no CMD ao rodar o scheduler)
    print(f"    [Omie] ListarMovimentos dDtPagtoDe={dDtPagtoDe!r} dDtPagtoAte={dDtPagtoAte!r} pagina={pagina}", flush=True)
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
            print(f"    Tentativa {tentativa}/{MAX_TENTATIVAS} falhou: {e}")
            if tentativa < MAX_TENTATIVAS:
                print(f"    Aguardando {ESPERA_ENTRE_TENTATIVAS}s antes de tentar novamente...")
                time.sleep(ESPERA_ENTRE_TENTATIVAS)
    raise ultimo_erro


def listar_pagamentos_paginado(
    app_key: str,
    app_secret: str,
    empresa_nome: str,
    dDtPagtoDe: str,
    dDtPagtoAte: str,
) -> tuple[list[dict], int]:
    """
    Chama ListarMovimentos com paginação até extrair todos os registros.
    Usa filtro de data de pagamento (dDtPagtoDe, dDtPagtoAte).
    """
    todos = []
    pagina = 1
    n_tot_paginas = 1

    while True:
        print(f"  Página {pagina}...", end=" ", flush=True)
        data = _chamar_api_com_retry(app_key, app_secret, pagina, dDtPagtoDe, dDtPagtoAte)

        n_tot_paginas = data.get("nTotPaginas", 1)
        if pagina == 1:
            print(f"\n  >> Total de páginas (API): {n_tot_paginas} <<\n", flush=True)
        movimentos = data.get("movimentos", [])

        if isinstance(movimentos, dict):
            movimentos = [movimentos]
        if not isinstance(movimentos, list):
            movimentos = []

        for mov in movimentos:
            rows = _transformar_movimento(mov, empresa_nome)
            todos.extend(rows)

        print(f"{len(movimentos)} registros (total: {len(todos)})", flush=True)

        if pagina >= n_tot_paginas:
            break
        pagina += 1
        time.sleep(1)

    print(f"\nTotal de páginas: {pagina}", flush=True)
    return todos, pagina


def _transformar_movimento(mov: dict, empresa: str) -> list[dict]:
    """
    Extrai campos do movimento para CSV.
    detalhes → prefixo det_
    resumo → prefixo res_
    Produto cartesiano: cada (categoria × departamento) vira uma linha.
    Filtros de conteúdo: alterar aqui (ex.: só cLiquidado = 'S' para pagamentos realizados).
    """
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

    n_cod_titulo = detalhes.get("nCodTitulo") if isinstance(detalhes, dict) else None
    if n_cod_titulo is None:
        return []

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

    # Produto cartesiano: para cada categoria, para cada departamento
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

            # categ_validada: categ_cod se preenchido, senão det_cCodCateg
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


def main():
    parser = argparse.ArgumentParser(
        description="API Omie - Pagamentos Realizados (filtro por data de pagamento)"
    )
    parser.add_argument(
        "--pagto-de",
        metavar="DD/MM/AAAA",
        default=DATA_PAGTO_DE_PADRAO,
        help="Data inicial de pagamento (padrão: 30 dias atrás).",
    )
    parser.add_argument(
        "--pagto-ate",
        metavar="DD/MM/AAAA",
        default=DATA_PAGTO_ATE_PADRAO,
        help="Data final de pagamento (padrão: ontem).",
    )
    args = parser.parse_args()

    base = Path(__file__).parent
    csv_empresas = base / CSV_EMPRESAS

    if not csv_empresas.exists():
        print(f"Arquivo não encontrado: {csv_empresas}")
        return 1

    empresas_config = ler_empresas_csv(csv_empresas)
    if not empresas_config:
        print("Nenhuma empresa com APP_KEY e APP_SECRET no CSV.")
        return 1

    cfg = empresas_config[0]
    app_key = cfg["APP_KEY"].strip()
    app_secret = cfg["APP_SECRET"].strip()
    empresa_nome = cfg.get("Empresa", cfg.get("APLICATIVO", "Empresa_1")).strip()

    dDtPagtoDe = (args.pagto_de or DATA_PAGTO_DE_PADRAO).strip()
    dDtPagtoAte = (args.pagto_ate or DATA_PAGTO_ATE_PADRAO).strip()

    print(f"Pagamentos Realizados - {empresa_nome}")
    print(f"  Pagamento: {dDtPagtoDe} a {dDtPagtoAte}")
    print(f"Retry: {MAX_TENTATIVAS}x com {ESPERA_ENTRE_TENTATIVAS}s entre falhas\n")

    os.makedirs(base / PASTA_SAIDA, exist_ok=True)

    try:
        registros, _ = listar_pagamentos_paginado(
            app_key, app_secret, empresa_nome, dDtPagtoDe, dDtPagtoAte
        )
    except Exception as e:
        print(f"\nERRO: {e}")
        return 1

    if not registros:
        print("\nNenhum registro para salvar.")
        return 0

    todos_campos = set()
    for r in registros:
        todos_campos.update(r.keys())
    campos = ["empresa"] + sorted(k for k in todos_campos if k != "empresa")
    arquivo_saida = base / PASTA_SAIDA / CSV_SAIDA

    with open(arquivo_saida, "w", encoding="utf-8-sig", newline="", errors="replace") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=campos,
            delimiter=";",
            extrasaction="ignore",
            quoting=csv.QUOTE_NONNUMERIC,
        )
        writer.writeheader()
        for r in registros:
            row = {}
            for k, v in r.items():
                if v is None or v == "":
                    row[k] = ""
                else:
                    s = str(v)
                    row[k] = s.replace("\r", " ").replace("\n", " ")
            writer.writerow(row)

    print(f"\nArquivo gerado: {arquivo_saida}")
    print(f"Total de {len(registros)} registro(s).")
    return 0


if __name__ == "__main__":
    exit(main())
