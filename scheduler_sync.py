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
from sync_recebimentos_supabase import executar_sync_recebimentos_empresas
from sync_titulos_pagos_a_vencer_supabase import executar_sync_titulos_pagos_a_vencer_empresas
from scheduler_status import limpar_em_execucao, registrar_em_execucao

# Carregar .env da raiz do projeto (fonte única de ENCRYPTION_KEY para o scheduler)
_root = os.path.dirname(os.path.abspath(__file__))
_env_path = os.path.join(_root, ".env")
if os.path.isfile(_env_path):
    load_dotenv(_env_path)
else:
    load_dotenv()
# Frontend .env.local: adiciona variáveis (ex.: SUPABASE_SERVICE_ROLE_KEY) SEM sobrescrever ENCRYPTION_KEY.
# Assim a chave da raiz (.env) prevalece e deve ser a MESMA no frontend/.env.local para criptografia bater.
_env_local = os.path.join(_root, "frontend", ".env.local")
if os.path.isfile(_env_local):
    load_dotenv(_env_local, override=False)

TZ = ZoneInfo("America/Sao_Paulo")
INTERVALO_SEGUNDOS = 60  # verifica a cada 60s o que está agendado e enfileira os jobs de API
ULTIMO_LOG_VERBOSE = [None]
SYNC_QUEUE = queue.Queue()
SUPABASE_CLIENT = None
# Deduplicação: evita loop e re-disparos indevidos
# - Jobs duplicados: vários agendamentos para o mesmo grupo/empresas = 1 job só
# - Cooldown: por work_key (grupo+empresas). Não enfileirar o mesmo job de novo antes de COOLDOWN_SEGUNDOS.
#   Job com muitas empresas pode levar vários minutos; com 2 min o scheduler re-enfileirava e gerava execução duplicada.
ULTIMO_ADDED = {}  # work_key -> timestamp da última vez que foi enfileirado
COOLDOWN_SEGUNDOS = 15 * 60  # 15 min: não re-enfileirar o mesmo grupo+empresas (evita duplicata quando o job demora vários minutos)


def _get_supabase():
    """Retorna cliente Supabase (criado uma vez). Prefere service_role para bypass de RLS no sync."""
    global SUPABASE_CLIENT
    if SUPABASE_CLIENT is None:
        url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        # service_role ignora RLS no Supabase — evita 42501 em recebimentos_omie e outras tabelas de sync
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) obrigatórios no .env ou frontend/.env.local")
        SUPABASE_CLIENT = create_client(url, key)
    return SUPABASE_CLIENT


def _log_verbose(horario_verificado: str = ""):
    agora = datetime.now(TZ)
    min_atual = int(agora.timestamp() // 60)
    ultimo = ULTIMO_LOG_VERBOSE[0]
    if ultimo is None or (min_atual - ultimo) >= 1:
        ULTIMO_LOG_VERBOSE[0] = min_atual
        qsize = SYNC_QUEUE.qsize()
        msg = f"[{agora.strftime('%H:%M:%S')}] Verificado {horario_verificado or agora.strftime('%H:%M')} — scheduler ativo"
        if qsize > 0:
            msg += f" (fila: {qsize} job(s))"
        msg += "..."
        print(msg, flush=True)


def obter_empresas_para_sync(supabase, grupo_ids: list[str], empresa_ids: list[str]) -> list[dict]:
    """
    Retorna lista de {id, nome_curto, app_key, app_secret} conforme o agendamento.
    Regra: se empresa_ids não for vazio, usa SOMENTE essas empresas (ignora grupo_ids).
    Se empresa_ids for vazio, usa as empresas dos grupo_ids. Assim a execução segue exatamente o que foi agendado.
    """
    empresas = []
    from utils.criptografia import descriptografar

    cols_com_plain = "id, nome_curto, app_key, app_secret_encrypted, app_secret"
    cols_sem_plain = "id, nome_curto, app_key, app_secret_encrypted"

    def _obter_secret(r):
        plain = (r.get("app_secret") or "").strip()
        if plain:
            return plain
        enc = r.get("app_secret_encrypted") or ""
        return descriptografar(enc) if enc else ""

    def _fetch(cols: str):
        if empresa_ids:
            # Agendamento por empresa: somente as empresas selecionadas
            res = supabase.from_("empresas").select(cols).in_("id", empresa_ids).eq("ativo", True).execute()
            for r in res.data or []:
                if r.get("app_key"):
                    empresas.append({"id": r["id"], "nome_curto": r["nome_curto"], "app_key": r["app_key"], "app_secret": _obter_secret(r)})
        elif grupo_ids:
            # Agendamento por grupo: somente as empresas dos grupos selecionados
            res = supabase.from_("empresas").select(cols).in_("grupo_id", grupo_ids).eq("ativo", True).execute()
            for r in res.data or []:
                if r.get("app_key"):
                    empresas.append({"id": r["id"], "nome_curto": r["nome_curto"], "app_key": r["app_key"], "app_secret": _obter_secret(r)})

    try:
        _fetch(cols_com_plain)
    except Exception:
        empresas.clear()
        _fetch(cols_sem_plain)
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
        api_tipos = [t for t in api_tipos_raw if t in ("clientes", "categorias", "movimento_financeiro", "movimentos_geral", "pagamentos_realizados", "recebimentos_omie")]
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
                    origem = "empresa_ids" if empresa_ids else "grupo_ids"
                    print(f"  [{label}] Executando para {len(empresas)} empresa(s) (agendamento por {origem}).", flush=True)
                    total = 0
                    # Ordem obrigatória: clientes e categorias antes de movimentos (FKs)
                    if "clientes" in api_tipos:
                        n = executar_sync_empresas(supabase, empresas, label)
                        total += n
                        print(f"  [{label}] Clientes: {n} registros.", flush=True)
                        try:
                            supabase.rpc("refresh_dashboard_receber_apos_acessorias").execute()
                            print(f"  [{label}] Grupos/view inadimplentes atualizados.", flush=True)
                        except Exception as e:
                            print(f"  [{label}] Aviso: refresh grupos/dashboard: {e}", flush=True)
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
                            supabase.rpc("refresh_dashboard_receber_apos_acessorias").execute()
                            print(f"  [{label}] Grupos/view inadimplentes atualizados.", flush=True)
                        except Exception as e:
                            print(f"  [{label}] Aviso: refresh grupos/dashboard: {e}", flush=True)
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
                    if "recebimentos_omie" in api_tipos:
                        n = executar_sync_recebimentos_empresas(supabase, empresas, label)
                        total += n
                        print(f"  [{label}] Recebimentos Omie: {n} registros.", flush=True)
                    if "movimentos_geral" in api_tipos:
                        n = executar_sync_titulos_pagos_a_vencer_empresas(supabase, empresas, label)
                        total += n
                        print(f"  [{label}] Movimentos Geral (Títulos pagos / Títulos a vencer): {n} registros.", flush=True)
                    if "clientes" in api_tipos or "categorias" in api_tipos or "movimento_financeiro" in api_tipos or "movimentos_geral" in api_tipos or "pagamentos_realizados" in api_tipos or "recebimentos_omie" in api_tipos:
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
    ordem_apis = ("clientes", "categorias", "movimento_financeiro", "movimentos_geral", "pagamentos_realizados", "recebimentos_omie")
    for work_key, (label, gids, eids, apis_set, data_de, data_ate) in jobs_unicos.items():
        api_tipos = [t for t in ordem_apis if t in apis_set]
        if not api_tipos:
            api_tipos = ["clientes"]
        jobs_finais.append((label, gids, eids, api_tipos, data_de, data_ate))

    jobs_ordenados = sorted(jobs_finais, key=lambda x: x[0].lower())
    adicionados = 0
    for label, gids, eids, api_tipos, data_de, data_ate in jobs_ordenados:
        work_key = (tuple(sorted(gids or [])), tuple(sorted(eids or [])))
        # Cooldown por work_key: evita enfileirar o mesmo job duas vezes seguidas (ex.: verificação às 16:51 e 16:52)
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
        print("Scheduler iniciado. Verificando agendamentos a cada 60s (UTC-3). Ctrl+C para parar.", flush=True)
    print("Dica: use SCHEDULER_DEBUG=1 para diagnóstico. Use --agora para forçar execução agora.", flush=True)

    # Diagnóstico de credenciais (evita 403 por app_secret vazio)
    try:
        supabase = _get_supabase()
        try:
            res = supabase.from_("empresas").select("id, nome_curto, app_key, app_secret_encrypted, app_secret").eq("ativo", True).limit(3).execute()
        except Exception:
            res = supabase.from_("empresas").select("id, nome_curto, app_key, app_secret_encrypted").eq("ativo", True).limit(3).execute()
        from utils.criptografia import descriptografar
        n_with_key = sum(1 for r in (res.data or []) if r.get("app_key"))
        n_with_secret = 0
        for r in res.data or []:
            plain = (r.get("app_secret") or "").strip()
            if plain:
                n_with_secret += 1
            else:
                enc = (r.get("app_secret_encrypted") or "").strip()
                if enc and descriptografar(enc):
                    n_with_secret += 1
        enc_ok = bool(os.getenv("ENCRYPTION_KEY", "").strip())
        if n_with_key > 0 and n_with_secret == 0:
            if not enc_ok:
                print("AVISO: ENCRYPTION_KEY não definida e nenhuma empresa com app_secret (texto) no Supabase → 403.", flush=True)
            else:
                print("AVISO: Nenhuma empresa com app_secret válido (preencha app_secret no Supabase ou confira app_secret_encrypted + ENCRYPTION_KEY).", flush=True)
        elif n_with_key > 0 and n_with_secret < n_with_key:
            print(f"AVISO: Apenas {n_with_secret}/{n_with_key} empresa(s) com secret ok. As demais podem dar 403.", flush=True)
    except Exception as e:
        print(f"AVISO: Não foi possível verificar credenciais: {e}", flush=True)

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
