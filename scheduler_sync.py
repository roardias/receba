"""
Scheduler - Disparo automático da sincronização Omie.
Lê api_agendamento, verifica horário (UTC-3) e executa sync para empresas/grupos configurados.

Utiliza fila de execução: jobs são enfileirados e processados em ordem (alfabética por grupo/empresa).
Se um sync estiver em andamento quando outro agendamento disparar, o novo entra na fila.
"""
import os
import sys
import queue
import threading

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import create_client

from sync_clientes_supabase import (
    listar_clientes_omie_completo,
    registrar_log,
    transformar_cliente,
    upsert_batch,
)
from sync_categorias_supabase import executar_sync_categorias_empresas
from sync_movimentos_supabase import executar_sync_movimentos_empresas
from sync_pagamentos_realizados_supabase import executar_sync_pagamentos_realizados_empresas
from scheduler_status import limpar_em_execucao, registrar_em_execucao

load_dotenv()

TZ = ZoneInfo("America/Sao_Paulo")
INTERVALO_SEGUNDOS = 30  # verifica a cada 30s (dobra chances de acertar o minuto agendado)
ULTIMO_LOG_VERBOSE = [None]
SYNC_QUEUE = queue.Queue()
SUPABASE_CLIENT = None
# Deduplicação: evita loop e re-disparos indevidos
# - Jobs duplicados: vários agendamentos para o mesmo grupo/empresas = 1 job só
# - Cooldown: não re-adicionar o mesmo trabalho em menos de 15 min (evita horários consecutivos)
ULTIMO_ADDED = {}  # work_key -> timestamp ( quando foi adicionado )
COOLDOWN_SEGUNDOS = 15 * 60  # 15 minutos entre execuções do mesmo grupo/empresas


def _get_supabase():
    """Retorna cliente Supabase (criado uma vez)."""
    global SUPABASE_CLIENT
    if SUPABASE_CLIENT is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL e SUPABASE_KEY obrigatórios no .env")
        SUPABASE_CLIENT = create_client(url, key)
    return SUPABASE_CLIENT


def _log_verbose(horario_verificado: str = ""):
    agora = datetime.now(TZ)
    min_atual = int(agora.timestamp() // 60)
    ultimo = ULTIMO_LOG_VERBOSE[0]
    if ultimo is None or (min_atual - ultimo) >= 2:
        ULTIMO_LOG_VERBOSE[0] = min_atual
        qsize = SYNC_QUEUE.qsize()
        msg = f"[{agora.strftime('%H:%M:%S')}] Verificado {horario_verificado or agora.strftime('%H:%M')} — scheduler ativo"
        if qsize > 0:
            msg += f" (fila: {qsize} job(s))"
        msg += "..."
        print(msg, flush=True)


def obter_empresas_para_sync(supabase, grupo_ids: list[str], empresa_ids: list[str]) -> list[dict]:
    """Retorna lista de {nome_curto, app_key, app_secret}."""
    empresas = []
    from utils.criptografia import descriptografar

    def _obter_secret(r):
        enc = r.get("app_secret_encrypted") or ""
        return descriptografar(enc) if enc else ""

    cols = "id, nome_curto, app_key, app_secret_encrypted"
    if grupo_ids:
        res = supabase.from_("empresas").select(cols).in_("grupo_id", grupo_ids).eq("ativo", True).execute()
        for r in res.data or []:
            if r.get("app_key"):
                secret = _obter_secret(r)
                empresas.append({"nome_curto": r["nome_curto"], "app_key": r["app_key"], "app_secret": secret})

    if empresa_ids:
        res = supabase.from_("empresas").select(cols).in_("id", empresa_ids).eq("ativo", True).execute()
        for r in res.data or []:
            if r.get("app_key") and not any(e["nome_curto"] == r["nome_curto"] for e in empresas):
                secret = _obter_secret(r)
                empresas.append({"nome_curto": r["nome_curto"], "app_key": r["app_key"], "app_secret": secret})

    return empresas


def _normalizar_hora(s: str) -> str:
    """Normaliza hora para HH:MM. Aceita '08:00', '08:00:00', '1970-01-01T08:00:00'."""
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


def _build_label_agendamento(supabase, grupo_ids: list, empresa_ids: list) -> str:
    """Monta label alfabética para ordenação (nomes de grupos e empresas)."""
    partes = []
    if grupo_ids:
        res = supabase.from_("grupos").select("id, nome").in_("id", grupo_ids).execute()
        nomes = [r["nome"] for r in (res.data or []) if r.get("nome")]
        partes.extend(sorted(nomes))
    if empresa_ids:
        res = supabase.from_("empresas").select("id, nome_curto").in_("id", empresa_ids).execute()
        nomes = [r["nome_curto"] for r in (res.data or []) if r.get("nome_curto")]
        partes.extend(sorted(nomes))
    return ", ".join(partes) if partes else "—"


def listar_jobs_agora(supabase, ignorar_horario: bool = False) -> list[tuple[str, list[str], list[str], list[str], str | None, str | None]]:
    """
    Retorna lista de (label, grupo_ids, empresa_ids, api_tipos, pagamentos_data_de, pagamentos_data_ate) que devem rodar AGORA (UTC-3).
    Cada agendamento corresponde a um job separado.
    Se ignorar_horario=True (--agora), inclui todos os agendamentos ativos do dia atual, ignorando horário.
    """
    agora = datetime.now(TZ)
    dia_semana = agora.weekday() + 1  # 1=Seg, 7=Dom
    hora_atual = agora.strftime("%H:%M")

    select_cols = "grupo_ids, empresa_ids, dias_semana, horarios, api_tipos, pagamentos_data_de, pagamentos_data_ate"
    try:
        res = supabase.from_("api_agendamento").select(select_cols).eq("ativo", True).execute()
    except Exception as e:
        err_str = str(e).lower()
        if "pagamentos_data" in err_str or "column" in err_str or "schema" in err_str or "cache" in err_str:
            select_cols = "grupo_ids, empresa_ids, dias_semana, horarios, api_tipos"
            res = supabase.from_("api_agendamento").select(select_cols).eq("ativo", True).execute()
        else:
            raise
    jobs = []
    debug = os.getenv("SCHEDULER_DEBUG", "").lower() in ("1", "true", "yes")

    for a in res.data or []:
        dias = a.get("dias_semana") or []
        horarios_raw = a.get("horarios") or []
        dias_int = []
        for d in dias or []:
            try:
                v = int(d)
                if 1 <= v <= 7:
                    dias_int.append(v)
            except (ValueError, TypeError):
                pass
        horarios = [_normalizar_hora(str(h)) for h in horarios_raw if h]

        if dia_semana not in dias_int:
            if debug:
                print(f"  [DEBUG] Agendamento ignorado: dia {dia_semana} não está em {dias_int}", flush=True)
            continue
        if not ignorar_horario and hora_atual not in horarios:
            if debug:
                print(f"  [DEBUG] Agendamento ignorado: hora {hora_atual!r} não está em {horarios}", flush=True)
            continue

        gids = [g for g in (a.get("grupo_ids") or []) if g]
        eids = [e for e in (a.get("empresa_ids") or []) if e]
        if not gids and not eids:
            if debug:
                print("  [DEBUG] Agendamento ignorado: sem grupo_ids nem empresa_ids", flush=True)
            continue

        api_tipos_raw = a.get("api_tipos") or ["clientes"]
        api_tipos = [t for t in api_tipos_raw if t in ("clientes", "categorias", "movimento_financeiro", "pagamentos_realizados")]
        if not api_tipos:
            api_tipos = ["clientes"]

        label = _build_label_agendamento(supabase, gids, eids)
        data_de = (a.get("pagamentos_data_de") or "").strip() or None
        data_ate = (a.get("pagamentos_data_ate") or "").strip() or None
        jobs.append((label, gids, eids, api_tipos, data_de, data_ate))

    return jobs


def executar_sync_empresas(supabase, empresas: list[dict], label: str = "") -> int:
    total = 0
    prefix = f"  [{label}] " if label else "  "
    for emp in empresas:
        nome = emp["nome_curto"]
        app_key = emp["app_key"]
        app_secret = emp.get("app_secret") or ""

        print(f"{prefix}Sync {nome}...", end=" ", flush=True)
        registrar_em_execucao(supabase, nome, "clientes", label)
        try:
            clientes_raw = listar_clientes_omie_completo(app_key, app_secret)
            clientes = [transformar_cliente(c, nome) for c in clientes_raw]
            if not clientes:
                print("0", flush=True)
                registrar_log(supabase, nome, "sucesso", 0)
                continue
            n = upsert_batch(supabase, clientes)
            registrar_log(supabase, nome, "sucesso", n)
            total += n
            print(n, flush=True)
        except Exception as e:
            print(f"ERRO: {e}", flush=True)
            registrar_log(supabase, nome, "erro", 0, str(e))
        finally:
            limpar_em_execucao(supabase)
    return total


def worker():
    """Thread que processa a fila de syncs."""
    while True:
        try:
            job = SYNC_QUEUE.get(timeout=1)
            if job is None:
                break
            label, grupo_ids, empresa_ids, api_tipos, pagamentos_data_de, pagamentos_data_ate = (
                (job[0], job[1], job[2], job[3], job[4] if len(job) > 4 else None, job[5] if len(job) > 5 else None)
            )
            try:
                supabase = _get_supabase()
                empresas = obter_empresas_para_sync(supabase, grupo_ids, empresa_ids)
                if not empresas:
                    print(f"  [{label}] Nenhuma empresa com credenciais.", flush=True)
                else:
                    total = 0
                    # Ordem obrigatória: clientes e categorias antes de movimentos (FKs)
                    if "clientes" in api_tipos:
                        n = executar_sync_empresas(supabase, empresas, label)
                        total += n
                        print(f"  [{label}] Clientes: {n} registros.", flush=True)
                    if "categorias" in api_tipos:
                        n = executar_sync_categorias_empresas(supabase, empresas, label)
                        total += n
                        print(f"  [{label}] Categorias: {n} registros.", flush=True)
                    if "movimento_financeiro" in api_tipos:
                        # Movimentos tem FK em clientes e categorias
                        n = executar_sync_movimentos_empresas(supabase, empresas, label)
                        total += n
                        print(f"  [{label}] Movimentos: {n} registros.", flush=True)
                        try:
                            supabase.rpc("refresh_dashboard_receber").execute()
                            print(f"  [{label}] Dashboard atualizado.", flush=True)
                        except Exception as e:
                            print(f"  [{label}] Aviso: refresh dashboard: {e}", flush=True)
                    if "pagamentos_realizados" in api_tipos:
                        n = executar_sync_pagamentos_realizados_empresas(
                            supabase, empresas, label,
                            dDtPagtoDe=pagamentos_data_de,
                            dDtPagtoAte=pagamentos_data_ate,
                        )
                        total += n
                        print(f"  [{label}] Pagamentos realizados: {n} registros.", flush=True)
                        try:
                            supabase.rpc("refresh_view_concimed_pagamentos_realizados").execute()
                            print(f"  [{label}] View Concimed (pagamentos) atualizada.", flush=True)
                        except Exception as e:
                            print(f"  [{label}] Aviso: refresh view Concimed: {e}", flush=True)
                    if "clientes" in api_tipos or "categorias" in api_tipos or "movimento_financeiro" in api_tipos or "pagamentos_realizados" in api_tipos:
                        print(f"  [{label}] Total: {total} registros.", flush=True)
            except Exception as e:
                print(f"  [{label}] Erro: {e}", flush=True)
            finally:
                SYNC_QUEUE.task_done()
        except queue.Empty:
            continue


def ciclo(ignorar_horario: bool = False):
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("SUPABASE_URL e SUPABASE_KEY obrigatórios no .env", flush=True)
        return

    supabase = _get_supabase()
    hora_agora = datetime.now(TZ).strftime("%H:%M")
    jobs = listar_jobs_agora(supabase, ignorar_horario=ignorar_horario)
    _log_verbose(hora_agora)

    debug = os.getenv("SCHEDULER_DEBUG", "").lower() in ("1", "true", "yes")
    if not jobs:
        if debug:
            res = supabase.from_("api_agendamento").select("id").eq("ativo", True).execute()
            n = len(res.data or [])
            if n > 0:
                print(f"  [DEBUG] {n} agendamento(s) ativo(s), mas nenhum coincide com hora/dia atual.", flush=True)
            else:
                print("  [DEBUG] Nenhum agendamento ativo cadastrado.", flush=True)
        return

    agora = datetime.now(TZ)
    now_ts = int(agora.timestamp())
    # Limpar entradas antigas do cooldown (evitar crescimento)
    expired = [k for k, t in ULTIMO_ADDED.items() if now_ts - t > COOLDOWN_SEGUNDOS]
    for k in expired:
        del ULTIMO_ADDED[k]

    # Coalesce: jobs com mesmo (gids, eids) viram 1 job com api_tipos unificados; datas de pagamentos do primeiro que tiver
    jobs_unicos = {}
    for label, gids, eids, api_tipos, data_de, data_ate in jobs:
        work_key = (tuple(sorted(gids or [])), tuple(sorted(eids or [])))
        if work_key not in jobs_unicos:
            jobs_unicos[work_key] = (label, gids, eids, set(api_tipos), data_de, data_ate)
        else:
            _, _, _, apis, cur_de, cur_ate = jobs_unicos[work_key]
            apis.update(api_tipos)
            if "pagamentos_realizados" in api_tipos and (not cur_de or not cur_ate) and (data_de and data_ate):
                jobs_unicos[work_key] = (label, gids, eids, apis, data_de, data_ate)
            else:
                jobs_unicos[work_key] = (label, gids, eids, apis, cur_de, cur_ate)

    jobs_finais = []
    for work_key, (label, gids, eids, apis_set, data_de, data_ate) in jobs_unicos.items():
        api_tipos = [t for t in ("clientes", "categorias", "movimento_financeiro", "pagamentos_realizados") if t in apis_set]
        if not api_tipos:
            api_tipos = ["clientes"]
        jobs_finais.append((label, gids, eids, api_tipos, data_de, data_ate))

    jobs_ordenados = sorted(jobs_finais, key=lambda x: x[0].lower())
    adicionados = 0
    for label, gids, eids, api_tipos, data_de, data_ate in jobs_ordenados:
        work_key = (tuple(sorted(gids or [])), tuple(sorted(eids or [])))
        if not ignorar_horario and work_key in ULTIMO_ADDED:
            if now_ts - ULTIMO_ADDED[work_key] < COOLDOWN_SEGUNDOS:
                continue
        ULTIMO_ADDED[work_key] = now_ts
        SYNC_QUEUE.put((label, gids, eids, api_tipos, data_de, data_ate))
        adicionados += 1

    if adicionados > 0:
        print(f"[{datetime.now(TZ).strftime('%H:%M:%S')}] {adicionados} job(s) adicionado(s) à fila (ordem: {', '.join(j[0] for j in jobs_ordenados)})", flush=True)


def main():
    forcar_agora = "--agora" in sys.argv
    if forcar_agora:
        print("Modo --agora: executando todos os agendamentos do dia uma vez (ignorando horário).", flush=True)
    else:
        print("Scheduler iniciado. Fila de execução ativa. Verificando a cada 30s (UTC-3). Ctrl+C para parar.", flush=True)
    print("Dica: use SCHEDULER_DEBUG=1 para diagnóstico. Use --agora para forçar execução agora.", flush=True)

    t = threading.Thread(target=worker, daemon=True)
    t.start()

    if forcar_agora:
        ciclo(ignorar_horario=True)
        print("Aguardando conclusão dos jobs na fila...", flush=True)
        SYNC_QUEUE.join()
        print("Execução forçada concluída.", flush=True)
        SYNC_QUEUE.put(None)
        return

    while True:
        try:
            ciclo()
        except KeyboardInterrupt:
            print("\nEncerrando...", flush=True)
            SYNC_QUEUE.put(None)
            break
        except Exception as e:
            print(f"Erro no ciclo: {e}", flush=True)
        time.sleep(INTERVALO_SEGUNDOS)


if __name__ == "__main__":
    main()
