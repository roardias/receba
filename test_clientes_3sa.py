"""
Teste isolado: lê 3Sa do exemplo_empresas.csv e chama a API Omie ListarClientes
(exatamente como o sync de clientes). Rode: python test_clientes_3sa.py
"""
import csv
import os
import sys

import requests

ENDPOINT = "https://app.omie.com.br/api/v1/geral/clientes/"


def credenciais_3sa_do_csv():
    base = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(base, "exemplo_empresas.csv")
    if not os.path.isfile(path):
        print(f"Arquivo não encontrado: {path}")
        return None
    with open(path, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f, delimiter=";")
        for row in reader:
            empresa = (row.get("Empresa") or row.get("APLICATIVO") or "").strip()
            if empresa and empresa.lower().replace(" ", "") == "3sa":
                key = (row.get("APP_KEY") or "").strip()
                secret = (row.get("APP_SECRET") or "").strip()
                if key and secret:
                    return (key, secret)
                print("Linha 3Sa encontrada mas APP_KEY ou APP_SECRET vazios.")
                return None
    print("Empresa 3Sa não encontrada no CSV.")
    return None


def main():
    cred = credenciais_3sa_do_csv()
    if not cred:
        return 1
    app_key, app_secret = cred
    print(f"Credenciais do CSV: APP_KEY={app_key!r} APP_SECRET={app_secret[:8]}...")

    payload = {
        "call": "ListarClientes",
        "param": [{"pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N"}],
        "app_key": app_key,
        "app_secret": app_secret,
    }
    print(f"POST {ENDPOINT} ...")
    try:
        resp = requests.post(
            ENDPOINT,
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=30,
        )
    except Exception as e:
        print(f"Erro de rede: {e}")
        return 1

    print(f"Status: {resp.status_code}")
    if resp.status_code != 200:
        print(f"Corpo: {resp.text[:500]}")
        return 1

    data = resp.json()
    if "faultstring" in data:
        print(f"Omie fault: {data['faultstring']}")
        return 1

    total = data.get("total_de_registros", 0)
    cadastros = data.get("clientes_cadastro", [])
    if isinstance(cadastros, dict):
        cadastros = [cadastros]
    print(f"OK. Total de registros: {total}, primeira página: {len(cadastros)} cliente(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
