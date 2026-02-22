#!/usr/bin/env python3
"""
Script standalone para importar cobranças do CSV (sistema Recebix) para a tabela
cobrancas_realizadas no Supabase. Preserva acentuação usando encoding correto.

Uso:
  python importar_cobrancas_recebix.py
  python importar_cobrancas_recebix.py --arquivo caminho/arquivo.csv
  python importar_cobrancas_recebix.py --encoding cp1252   # se o CSV veio em Latin-1/Windows
  python importar_cobrancas_recebix.py --limpar           # apaga a tabela antes de importar
  python importar_cobrancas_recebix.py --dry-run           # só mostra o que seria importado

Requer .env: SUPABASE_URL e SUPABASE_KEY. Se existir SUPABASE_SERVICE_ROLE_KEY, usa ela para importar (bypass RLS).
"""

import argparse
import csv
import os
import sys
from pathlib import Path
from datetime import datetime

# Carrega .env do diretório do script ou do cwd
def _load_dotenv():
    try:
        import dotenv
        env_path = Path(__file__).resolve().parent / ".env"
        if env_path.exists():
            dotenv.load_dotenv(env_path)
        else:
            dotenv.load_dotenv()
    except ImportError:
        pass

_load_dotenv()

from supabase import create_client, Client


# Colunas que são booleanas no banco
BOOL_COLUNAS = {"foi_atendido", "houve_negociacao", "houve_desconto"}

# Colunas numéricas
NUMERIC_COLUNAS = {"valor_desconto"}

# Colunas de data (apenas data, sem hora)
DATE_COLUNAS = {"data_prevista_pagamento"}

# Colunas de timestamp (created_at)
TIMESTAMP_COLUNAS = {"created_at"}


def _parse_bool(val: str) -> bool | None:
    if val is None or (isinstance(val, str) and val.strip() == ""):
        return None
    v = str(val).strip().lower()
    if v in ("1", "true", "sim", "s", "yes"):
        return True
    if v in ("0", "false", "não", "nao", "n", "no"):
        return False
    return None


def _parse_date(val: str) -> str | None:
    if val is None or (isinstance(val, str) and val.strip() == ""):
        return None
    s = str(val).strip()
    if not s:
        return None
    try:
        # "2025-11-14" ou "2025-11-14 09:45:00+00"
        if " " in s:
            s = s.split(" ")[0]
        dt = datetime.strptime(s, "%Y-%m-%d")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        return None


def _parse_timestamp(val: str) -> str | None:
    if val is None or (isinstance(val, str) and val.strip() == ""):
        return None
    s = str(val).strip()
    if not s:
        return None
    # Postgres aceita "2025-11-14 09:45:00+00"; normalizar +00 -> +00:00 para ISO
    if s.endswith("+00") and ":" not in s[-4:]:
        return s.replace("+00", "+00:00")
    if s.endswith("-00") and ":" not in s[-4:]:
        return s.replace("-00", "-00:00")
    return s


def _parse_numeric(val: str) -> float | None:
    if val is None or (isinstance(val, str) and val.strip() == ""):
        return None
    s = str(val).strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _celula_vazia(val: str) -> bool:
    if val is None:
        return True
    return str(val).strip() == ""


def normalizar_linha(raw: dict[str, str], colunas: list[str]) -> dict:
    out = {}
    for col in colunas:
        val = raw.get(col, "").strip() if raw.get(col) is not None else ""
        if col in BOOL_COLUNAS:
            out[col] = _parse_bool(val)
        elif col in NUMERIC_COLUNAS:
            out[col] = _parse_numeric(val)
        elif col in DATE_COLUNAS:
            out[col] = _parse_date(val)
        elif col in TIMESTAMP_COLUNAS:
            out[col] = _parse_timestamp(val)
        else:
            # Texto: string vazia vira None para o banco
            out[col] = val if val else None
    return out


def ler_csv(arquivo: Path, encoding: str = "utf-8", delimiter: str = ";"):
    with open(arquivo, "r", encoding=encoding, newline="") as f:
        reader = csv.DictReader(f, delimiter=delimiter, quotechar='"')
        colunas = [c.strip() for c in reader.fieldnames] if reader.fieldnames else []
        for row in reader:
            # DictReader usa as colunas do header; garantir que keys batem
            clean = {k.strip(): v for k, v in row.items() if k}
            yield colunas, clean


def main():
    parser = argparse.ArgumentParser(description="Importar cobranças do CSV Recebix para Supabase")
    parser.add_argument("--arquivo", "-a", default="carga_cobrancas_realizadas_recebix.csv", help="Caminho do CSV")
    parser.add_argument("--encoding", "-e", default="utf-8", help="Encoding do CSV (utf-8, cp1252, latin-1)")
    parser.add_argument("--limpar", action="store_true", help="Apagar registros da tabela antes de importar (usa delete, não truncate)")
    parser.add_argument("--dry-run", action="store_true", help="Só validar e mostrar quantidade de linhas, não envia ao Supabase")
    parser.add_argument("--lote", type=int, default=200, help="Tamanho do lote de insert (default 200)")
    args = parser.parse_args()

    arquivo = Path(args.arquivo)
    if not arquivo.is_absolute():
        arquivo = Path(__file__).resolve().parent / arquivo
    if not arquivo.exists():
        print(f"Arquivo não encontrado: {arquivo}", file=sys.stderr)
        sys.exit(1)

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("Defina SUPABASE_URL e SUPABASE_KEY no .env", file=sys.stderr)
        sys.exit(1)

    # Ler todas as linhas (para contar e processar em lotes)
    encoding = args.encoding
    linhas = []
    try:
        with open(arquivo, "r", encoding=encoding, newline="") as f:
            reader = csv.DictReader(f, delimiter=";", quotechar='"')
            colunas = [c.strip() for c in reader.fieldnames] if reader.fieldnames else []
            linhas = list(reader)
    except UnicodeDecodeError as e:
        if encoding == "utf-8":
            # Muitos CSV exportados no Windows vêm em cp1252; tentar automaticamente
            encoding = "cp1252"
            print("UTF-8 falhou; tentando cp1252 (Windows/Latin-1)...", file=sys.stderr)
            try:
                with open(arquivo, "r", encoding=encoding, newline="") as f:
                    reader = csv.DictReader(f, delimiter=";", quotechar='"')
                    colunas = [c.strip() for c in reader.fieldnames] if reader.fieldnames else []
                    linhas = list(reader)
            except UnicodeDecodeError:
                print(f"Erro de encoding: {e}", file=sys.stderr)
                print("Use: --encoding cp1252 (ou latin-1) se o CSV veio do Excel/Windows.", file=sys.stderr)
                sys.exit(1)
        else:
            print(f"Erro de encoding ao abrir o CSV: {e}", file=sys.stderr)
            sys.exit(1)

    if not colunas:
        print("CSV sem cabeçalho ou vazio.", file=sys.stderr)
        sys.exit(1)

    # Garantir ordem das colunas esperada pela tabela (id e registro_id primeiro, etc.)
    ordem_tabela = [
        "id", "registro_id", "tipo", "created_at", "cod_cliente", "cnpj_cpf", "cliente_nome",
        "grupo_nome", "empresas_internas_nomes", "emails_destinatarios", "email_remetente",
        "foi_atendido", "nome_pessoa", "cargo_pessoa", "houve_negociacao", "observacao_nao_negociacao",
        "data_prevista_pagamento", "houve_desconto", "valor_desconto", "motivo_desconto",
        "observacao", "mensagem_whatsapp_enviada", "nome_quem_conversou", "cargo_quem_conversou",
    ]
    # Usar só as que existem no CSV
    colunas_ordem = [c for c in ordem_tabela if c in colunas]
    for c in colunas:
        if c not in colunas_ordem:
            colunas_ordem.append(c)

    rows_ok = []
    erros = []
    for i, raw in enumerate(linhas):
        clean = {k.strip(): v for k, v in raw.items() if k}
        try:
            row = normalizar_linha(clean, colunas_ordem)
            # Garantir id e registro_id como string UUID (Supabase/Postgres aceita)
            if row.get("id") is None and clean.get("id"):
                row["id"] = str(clean.get("id", "")).strip() or None
            if row.get("registro_id") is None and clean.get("registro_id"):
                row["registro_id"] = str(clean.get("registro_id", "")).strip() or None
            if not row.get("id") or not row.get("registro_id"):
                erros.append((i + 2, "id ou registro_id vazio", clean.get("id"), clean.get("registro_id")))
                continue
            rows_ok.append(row)
        except Exception as ex:
            erros.append((i + 2, str(ex), None, None))

    total = len(rows_ok)
    print(f"Linhas válidas: {total} | Erros: {len(erros)}")
    if erros and len(erros) <= 20:
        for linha, msg, a, b in erros:
            print(f"  Linha {linha}: {msg}")
    elif erros:
        print(f"  (primeiros 20 erros mostrados)")
        for linha, msg, a, b in erros[:20]:
            print(f"  Linha {linha}: {msg}")

    if args.dry_run:
        if total:
            print(f"Dry-run: {total} registros seriam importados (encoding: {encoding}).")
        return

    if not rows_ok:
        print("Nada a importar.")
        return

    supabase: Client = create_client(url, key)

    if args.limpar:
        print("Limpando tabela cobrancas_realizadas...")
        # Delete em lotes para não estourar
        while True:
            r = supabase.table("cobrancas_realizadas").select("id", count="exact").limit(1000).execute()
            ids = [x["id"] for x in (r.data or [])]
            if not ids:
                break
            supabase.table("cobrancas_realizadas").delete().in_("id", ids).execute()
        print("Tabela limpa.")

    inseridos = 0
    try:
        for i in range(0, total, args.lote):
            lote = rows_ok[i : i + args.lote]
            supabase.table("cobrancas_realizadas").insert(lote).execute()
            inseridos += len(lote)
            print(f"Inseridos {inseridos}/{total} ...")
    except Exception as ex:
        print(f"Erro no lote (linhas ~{i+2} a ~{i+len(lote)+1}): {ex}", file=sys.stderr)
        raise

    print(f"Concluído: {inseridos} registros importados.")


if __name__ == "__main__":
    main()
