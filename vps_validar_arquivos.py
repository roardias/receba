#!/usr/bin/env python3
"""
Rode ESTE script NA VPS, na pasta raiz do projeto (onde fica scheduler_sync.py).
Mostra quais arquivos obrigatórios existem (OK) e quais faltam (FALTA).

Uso:
  python3 vps_validar_arquivos.py
  python3 vps_validar_arquivos.py --falta   # só lista o que falta (um por linha)
"""

import os
import sys

# Lista de arquivos/pastas obrigatórios (mesma do docs/VPS_SUBIR_ARQUIVOS.md)
OBRIGATORIOS = [
    "scheduler_sync.py",
    "scheduler_status.py",
    "sync_clientes_supabase.py",
    "sync_categorias_supabase.py",
    "sync_movimentos_supabase.py",
    "sync_pagamentos_realizados_supabase.py",
    "sync_recebimentos_supabase.py",
    "sync_titulos_pagos_a_vencer_supabase.py",
    "api_omie_movimentos_geral.py",
    "api_omie_clientes.py",
    "api_omie_categorias.py",
    "api_omie_movimentos.py",
    "api_omie_pagamentos_realizados.py",
    "api_omie_recebimentos.py",
    "utils",  # pasta
]

# Opcional: arquivo com espaço no nome
OPCIONAL = "api_omie_movimentos - Geral.py"


def main():
    base = os.path.dirname(os.path.abspath(__file__)) or "."
    only_missing = "--falta" in sys.argv or "-f" in sys.argv

    ok = []
    falta = []

    for name in OBRIGATORIOS:
        path = os.path.join(base, name)
        exists = os.path.isdir(path) if name == "utils" else os.path.isfile(path)
        if exists:
            ok.append(name)
        else:
            falta.append(name)

    # Opcional
    path_opt = os.path.join(base, OPCIONAL)
    if os.path.isfile(path_opt):
        ok.append(OPCIONAL)
    else:
        falta.append(OPCIONAL + " (opcional)")

    if only_missing:
        for name in falta:
            # não incluir " (opcional)" no nome do arquivo para uso em script
            print(name.replace(" (opcional)", ""))
        return

    print("=== Validação dos arquivos na VPS ===\n")
    for name in ok:
        print("  OK   ", name)
    for name in falta:
        print("  FALTA", name)
    print()
    print(f"Total: {len(ok)} presentes, {len(falta)} faltando.")
    if falta:
        print("\nPara listar só o que falta:  python3 vps_validar_arquivos.py --falta")


if __name__ == "__main__":
    main()
