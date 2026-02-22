"""
Diagnóstico do scheduler - mostra por que um agendamento dispara ou não.
Execute: python diagnostico_scheduler.py
"""
import os
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

TZ = ZoneInfo("America/Sao_Paulo")


def _normalizar_hora(s: str) -> str:
    """Normaliza hora para HH:MM."""
    if not s:
        return s
    s = str(s).strip()
    if "T" in s:
        s = s.split("T")[-1]
    if ":" not in s:
        return s
    parts = s.split(":")
    if len(parts) >= 2:
        try:
            return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
        except (ValueError, TypeError):
            pass
    return s


def main():
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("SUPABASE_URL e SUPABASE_KEY obrigatórios no .env")
        return

    supabase = create_client(url, key)
    agora = datetime.now(TZ)
    dia_semana = agora.weekday() + 1  # 1=Seg, 7=Dom
    hora_atual = agora.strftime("%H:%M")

    print("=" * 60)
    print("DIAGNÓSTICO DO SCHEDULER")
    print("=" * 60)
    print(f"Data/hora atual (Brasília): {agora.strftime('%d/%m/%Y %H:%M:%S')}")
    print(f"Dia da semana (1=Seg..7=Dom): {dia_semana}")
    print(f"Horário para comparação: \"{hora_atual}\"")
    print()

    res = supabase.from_("api_agendamento").select("id, grupo_ids, empresa_ids, dias_semana, horarios, ativo").execute()
    agendamentos = res.data or []

    if not agendamentos:
        print("Nenhum agendamento cadastrado na tabela api_agendamento.")
        return

    print(f"Total de agendamentos: {len(agendamentos)}\n")

    for i, a in enumerate(agendamentos, 1):
        ativo = a.get("ativo", True)
        dias = a.get("dias_semana") or []
        horarios = a.get("horarios") or []
        grupo_ids = a.get("grupo_ids") or []
        empresa_ids = a.get("empresa_ids") or []
        grupo_id = a.get("grupo_id")  # legado
        empresa_id = a.get("empresa_id")  # legado
        tem_grupos = bool(grupo_ids or grupo_id)
        tem_empresas = bool(empresa_ids or empresa_id)

        dias_int = []
        for d in dias:
            try:
                v = int(d)
                if 1 <= v <= 7:
                    dias_int.append(v)
            except (ValueError, TypeError):
                pass
        horarios_norm = [_normalizar_hora(str(h)) for h in horarios if h]

        dia_ok = dia_semana in dias_int
        hora_ok = hora_atual in horarios_norm
        dispara = ativo and dia_ok and hora_ok and (tem_grupos or tem_empresas)

        print(f"--- Agendamento {i} ---")
        print(f"  grupo_ids: {grupo_ids or '(vazio)'} | empresa_ids: {empresa_ids or '(vazio)'}")
        print(f"  Ativo: {ativo}")
        print(f"  dias_semana no banco: {dias} -> normalizado: {dias_int}")
        print(f"  horarios no banco: {horarios} -> normalizado: {horarios_norm}")
        print(f"  Dia {dia_semana} está em dias_int? {dia_ok}")
        print(f"  Horário \"{hora_atual}\" está em horarios_norm? {hora_ok}")
        print(f"  Teria grupo/empresa? {tem_grupos or tem_empresas}")
        print(f"  >>> DISPARARIA AGORA: {'SIM' if dispara else 'NÃO'}")
        print()

if __name__ == "__main__":
    main()
