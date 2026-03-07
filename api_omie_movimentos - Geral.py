"""
Movimentos Geral - Entrada para rodar o sync titulos_pagos / titulos_a_vencer.
Não gera CSV: trata os dados da API Omie e faz insert no Supabase
(usa a mesma lógica de sync_titulos_pagos_a_vencer_supabase).
Para rodar no CMD: configure SUPABASE_URL e SUPABASE_KEY no .env e tenha exemplo_empresas.csv.
Para agendamento: use a opção "Movimentos Geral" em Configurações > Agendamentos.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

from api_omie_clientes import ler_empresas_csv
from sync_titulos_pagos_a_vencer_supabase import executar_sync_titulos_pagos_a_vencer_empresas

load_dotenv()

CSV_EMPRESAS = "exemplo_empresas.csv"


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

    empresas_csv = ler_empresas_csv(str(csv_path))
    if not empresas_csv:
        print("Nenhuma empresa com APP_KEY e APP_SECRET no CSV.")
        return 1

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

    supabase = create_client(url, key)
    total = executar_sync_titulos_pagos_a_vencer_empresas(supabase, empresas, label="")
    print(f"\nTotal: {total} registros (titulos_pagos + titulos_a_vencer)")
    return 0


if __name__ == "__main__":
    exit(main())
