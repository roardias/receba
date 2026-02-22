#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Converte CSV (delimitador ;, campos entre aspas) em Excel (.xlsx).
Mantém acentos e quebra correta das colunas (respeita aspas e ; dentro de observações).

Uso:
    python csv_para_excel.py
    python csv_para_excel.py caminho/do/arquivo.csv

Requer: pip install openpyxl
"""

import csv
import os
import sys
from pathlib import Path

try:
    import openpyxl
    from openpyxl import Workbook
except ImportError:
    print("Instale openpyxl: pip install openpyxl")
    sys.exit(1)


def main():
    if len(sys.argv) > 1:
        csv_path = Path(sys.argv[1])
    else:
        csv_path = Path(__file__).parent / "cobrancas_realizadas-export-2026-02-22_08-48-26.csv"

    if not csv_path.exists():
        print(f"Arquivo não encontrado: {csv_path}")
        sys.exit(1)

    # CSV com ; e aspas: o módulo csv do Python trata corretamente campos entre aspas
    rows = []
    with open(csv_path, "r", encoding="utf-8", newline="") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"', doublequote=True)
        for row in reader:
            rows.append(row)

    if not rows:
        print("Nenhuma linha no CSV.")
        sys.exit(1)

    wb = Workbook()
    ws = wb.active
    ws.title = "Cobranças"

    for r, row in enumerate(rows, start=1):
        for c, value in enumerate(row, start=1):
            ws.cell(row=r, column=c, value=value)

    downloads = Path(os.environ.get("USERPROFILE", os.path.expanduser("~"))) / "Downloads"
    out_path = downloads / csv_path.with_suffix(".xlsx").name
    wb.save(out_path)
    print(f"Salvo: {out_path}")


if __name__ == "__main__":
    main()
