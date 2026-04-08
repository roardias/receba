"""
Movimentos Geral - Entrada para rodar o sync titulos_pagos / titulos_a_vencer.
Não gera CSV: trata os dados da API Omie e faz insert no Supabase
(usa a mesma lógica de sync_titulos_pagos_a_vencer_supabase).

Este script está configurado para rodar APENAS as empresas do grupo Concimed,
buscando-as na tabela empresas do Supabase (por grupo.nome ILIKE '%Concimed%').

Para rodar no PowerShell: configure SUPABASE_URL e SUPABASE_KEY no .env e execute:
  python "api_omie_movimentos - Geral2.py"
"""

import os

from dotenv import load_dotenv
from supabase import create_client

from sync_titulos_pagos_a_vencer_supabase import executar_sync_titulos_pagos_a_vencer_empresas

load_dotenv()

# Nome do grupo para filtrar empresas (Concimed)
GRUPO_CONCIMED = "Concimed"


def buscar_empresas_grupo_concimed(supabase):
    """
    Busca no Supabase todas as empresas do grupo Concimed que tenham app_key e app_secret.
    Retorna lista de dict com nome_curto, app_key, app_secret.
    """
    # 1) Grupos cujo nome contém "Concimed"
    res_grupos = supabase.table("grupos").select("id").ilike("nome", f"%{GRUPO_CONCIMED}%").execute()
    grupo_ids = [g["id"] for g in (res_grupos.data or [])]
    if not grupo_ids:
        return []

    # 2) Empresas desses grupos com app_key e app_secret preenchidos
    empresas = []
    for gid in grupo_ids:
        res = supabase.table("empresas").select("nome_curto, app_key, app_secret").eq("grupo_id", gid).execute()
        for row in res.data or []:
            ak = (row.get("app_key") or "").strip() if row.get("app_key") else ""
            as_ = (row.get("app_secret") or "").strip() if row.get("app_secret") else ""
            nome = (row.get("nome_curto") or "").strip()
            if ak and as_ and nome:
                empresas.append({"nome_curto": nome, "app_key": ak, "app_secret": as_})

    return empresas


def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Configure SUPABASE_URL e SUPABASE_KEY no .env")
        return 1

    supabase = create_client(url, key)
    empresas = buscar_empresas_grupo_concimed(supabase)

    if not empresas:
        print(f"Nenhuma empresa do grupo '{GRUPO_CONCIMED}' encontrada no Supabase com app_key e app_secret.")
        return 1

    print(f"Empresas do grupo {GRUPO_CONCIMED}: {[e['nome_curto'] for e in empresas]}")
    total = executar_sync_titulos_pagos_a_vencer_empresas(supabase, empresas, label=GRUPO_CONCIMED)
    print(f"\nTotal: {total} registros (titulos_pagos + titulos_a_vencer)")
    return 0


if __name__ == "__main__":
    exit(main())
