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
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from supabase import create_client

try:
    from supabase import ClientOptions
except ImportError:
    from supabase.lib.client_options import ClientOptions

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
ULTIMO_LOG_VERBOSE = [None]
SYNC_QUEUE = queue.Queue()
SUPABASE_CLIENT = None
# Deduplicação: evita loop e re-disparos indevidos
# - Jobs duplicados: vários agendamentos para o mesmo grupo/empresas = 1 job só
# - Cooldown: por work_key (grupo+empresas+api_tipos). Não enfileirar o mesmo job de novo antes de COOLDOWN_SEGUNDOS.
#   Job com muitas empresas pode levar vários minutos; com 2 min o scheduler re-enfileirava e gerava execução duplicada.
ULTIMO_ADDED = {}  # work_key -> timestamp da última vez que foi enfileirado
COOLDOWN_SEGUNDOS = 15 * 60  # 15 min: não re-enfileirar o mesmo grupo+empresas (evita duplicata quando o job demora vários minutos)

# Registro de execuções (api_agendamento_execucoes): cada vencimento de agendamento vira uma linha
# no banco (UNIQUE agendamento_id+agendado_para). O scheduler pergunta "o que venceu e ainda não rodou?"
# em vez de "agora é o minuto exato?" — cobre rede fora do ar, restart e reboot da VPS.
JANELA_RECUPERACAO_HORAS = 6  # vencimentos até 6h atrás ainda são executados se ninguém os reivindicou
LEDGER_AVISADO_INDISPONIVEL = [False]  # evita repetir o aviso quando a tabela ainda não existe
OCORRENCIAS_TRATADAS = {}  # (agendamento_id, vencimento_iso) -> ts: já reivindicado/verificado por este processo (evita repetir upsert a cada minuto)


def _get_supabase():
    """Retorna cliente Supabase (criado uma vez). Prefere service_role para bypass de RLS no sync."""
    global SUPABASE_CLIENT
    if SUPABASE_CLIENT is None:
        # Compatibilidade: algumas versões da gotrue passam `proxy=` para httpx.Client.
        # Em outras versões do httpx, o construtor aceita apenas `proxies=`.
        # Este patch evita crash por TypeError ao instanciar o client.
        try:
            import httpx
            import inspect

            if "proxy" not in inspect.signature(httpx.Client.__init__).parameters:
                _orig_init = httpx.Client.__init__

                def _patched_init(self, *args, proxy=None, **kwargs):
                    if proxy is not None and "proxies" not in kwargs:
                        kwargs["proxies"] = proxy
                    return _orig_init(self, *args, **kwargs)

                httpx.Client.__init__ = _patched_init  # type: ignore[assignment]
        except Exception:
            # Se não der para fazer o patch, seguimos e deixamos o erro original aparecer.
            pass

        url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
        # service_role ignora RLS no Supabase — evita 42501 em recebimentos_omie e outras tabelas de sync
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
        if not url or not key:
            raise ValueError("SUPABASE_URL (ou NEXT_PUBLIC_SUPABASE_URL) e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) obrigatórios no .env ou frontend/.env.local")
        # Timeout de 120s (padrão da lib é 5s): operações pesadas, como limpar/upsert de tabelas
        # grandes, demoravam >5s e o timeout abortava o job no meio (tabela ficava vazia).
        SUPABASE_CLIENT = create_client(url, key, options=ClientOptions(postgrest_client_timeout=120))
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


def _ocorrencias_devidas(dias_int: list[int], horarios: list[str], agora: datetime) -> list[datetime]:
    """
    Vencimentos do agendamento dentro da janela [agora - JANELA_RECUPERACAO_HORAS, agora].
    O dia da semana é avaliado no DIA DO VENCIMENTO (não no dia atual), para a madrugada
    não perder vencimentos do dia anterior.
    """
    inicio = agora - timedelta(hours=JANELA_RECUPERACAO_HORAS)
    ocorrencias = []
    for delta_dias in (1, 0):  # ontem e hoje (janela < 24h)
        dia = (agora - timedelta(days=delta_dias)).date()
        if dia.isoweekday() not in dias_int:
            continue
        for h in horarios:
            try:
                hh, mm = h.split(":")
                dt = datetime(dia.year, dia.month, dia.day, int(hh), int(mm), tzinfo=TZ)
            except (ValueError, TypeError):
                continue
            if inicio <= dt <= agora:
                ocorrencias.append(dt)
    return ocorrencias


def _reivindicar_execucao(supabase, agendamento_id: str, agendado_para: datetime, status: str = "pendente") -> str | None:
    """
    Tenta registrar o vencimento em api_agendamento_execucoes (ON CONFLICT DO NOTHING via
    ignore_duplicates). Retorna o id da execução se ESTE processo a reivindicou agora;
    None se já existia (outro ciclo/processo já tratou este vencimento).
    """
    res = (
        supabase.table("api_agendamento_execucoes")
        .upsert(
            {
                "agendamento_id": agendamento_id,
                "agendado_para": agendado_para.astimezone(timezone.utc).isoformat(),
                "status": status,
            },
            on_conflict="agendamento_id,agendado_para",
            ignore_duplicates=True,
        )
        .execute()
    )
    if res.data:
        return res.data[0]["id"]
    return None


def _ledger_indisponivel(e: Exception) -> bool:
    """True se o erro indica que a tabela api_agendamento_execucoes ainda não existe no banco."""
    msg = str(e)
    return "api_agendamento_execucoes" in msg or "42P01" in msg


def _avisar_ledger_indisponivel(e: Exception):
    if not LEDGER_AVISADO_INDISPONIVEL[0]:
        LEDGER_AVISADO_INDISPONIVEL[0] = True
        print(
            f"AVISO: tabela api_agendamento_execucoes indisponível ({e}). "
            "Aplique a migration api_agendamento_execucoes.sql no Supabase. "
            "Enquanto isso, o scheduler usa o disparo por minuto exato (sem recuperação de horários perdidos).",
            flush=True,
        )


def _atualizar_execucoes(exec_ids: list[str], status: str, erro: str | None = None, marcar_inicio: bool = False, marcar_fim: bool = False):
    """Atualiza status/horários das execuções no registro. Falha aqui não pode derrubar o job."""
    if not exec_ids:
        return
    try:
        supabase = _get_supabase()
        payload = {"status": status}
        agora_iso = datetime.now(timezone.utc).isoformat()
        if marcar_inicio:
            payload["iniciado_em"] = agora_iso
        if marcar_fim:
            payload["finalizado_em"] = agora_iso
        if erro is not None:
            payload["erro"] = str(erro)[:2000]
        supabase.table("api_agendamento_execucoes").update(payload).in_("id", exec_ids).execute()
    except Exception as e:
        print(f"  Aviso: não foi possível atualizar status da execução no registro: {e}", flush=True)


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


def listar_jobs_agora(supabase, ignorar_horario: bool = False) -> list[tuple[str, list[str], list[str], list[str], str | None, str | None, list[str]]]:
    """
    Retorna lista de (label, grupo_ids, empresa_ids, api_tipos, pagamentos_data_de, pagamentos_data_ate, exec_ids)
    que devem rodar AGORA (UTC-3).
    Modo normal: procura VENCIMENTOS dentro da janela de recuperação e reivindica cada um em
    api_agendamento_execucoes (UNIQUE no banco garante execução única). Assim um horário não é
    perdido se o scheduler estiver sem rede, reiniciando ou fora do ar no minuto exato.
    Se ignorar_horario=True (--agora), inclui todos os agendamentos ativos do dia atual, sem registrar execuções.
    Fallback: se a tabela de execuções ainda não existir, usa o disparo por minuto exato (comportamento antigo).
    """
    agora = datetime.now(TZ)
    dia_semana = agora.weekday() + 1  # 1=Seg, 7=Dom
    hora_atual = agora.strftime("%H:%M")

    # Limpeza do cache de vencimentos tratados (evita crescimento sem limite)
    limite_cache = time.time() - (JANELA_RECUPERACAO_HORAS + 1) * 3600
    for k in [k for k, ts in OCORRENCIAS_TRATADAS.items() if ts < limite_cache]:
        del OCORRENCIAS_TRATADAS[k]

    select_cols = "id, grupo_ids, empresa_ids, dias_semana, horarios, api_tipos, pagamentos_data_de, pagamentos_data_ate"
    try:
        res = supabase.from_("api_agendamento").select(select_cols).eq("ativo", True).execute()
    except Exception as e:
        err_str = str(e).lower()
        if "pagamentos_data" in err_str or "column" in err_str or "schema" in err_str or "cache" in err_str:
            select_cols = "id, grupo_ids, empresa_ids, dias_semana, horarios, api_tipos"
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

        exec_ids: list[str] = []
        if ignorar_horario:
            if dia_semana not in dias_int:
                if debug:
                    print(f"  [DEBUG] Agendamento ignorado: dia {dia_semana} não está em {dias_int}", flush=True)
                continue
        else:
            ocorrencias = _ocorrencias_devidas(dias_int, horarios, agora)
            if not ocorrencias:
                if debug:
                    print(f"  [DEBUG] Agendamento ignorado: hora {hora_atual!r} sem vencimento em {horarios} (dias {dias_int}, janela {JANELA_RECUPERACAO_HORAS}h)", flush=True)
                continue
            usar_minuto_exato = False
            for dt in ocorrencias:
                # Cache em memória: vencimento já reivindicado/verificado por este processo
                # não precisa de novo upsert a cada minuto durante toda a janela.
                occ_key = (a.get("id"), dt.isoformat())
                if occ_key in OCORRENCIAS_TRATADAS:
                    continue
                try:
                    exec_id = _reivindicar_execucao(supabase, a.get("id"), dt)
                except Exception as e:
                    if _ledger_indisponivel(e):
                        _avisar_ledger_indisponivel(e)
                        usar_minuto_exato = True
                        break
                    raise
                OCORRENCIAS_TRATADAS[occ_key] = time.time()
                if exec_id:
                    exec_ids.append(exec_id)
                    print(f"  Execução reivindicada: vencimento {dt.strftime('%d/%m %H:%M')} (agendamento {a.get('id')})", flush=True)
            if usar_minuto_exato:
                # Comportamento antigo (sem registro no banco): dispara só no minuto exato
                if dia_semana not in dias_int or hora_atual not in horarios:
                    continue
            elif not exec_ids:
                if debug:
                    print(f"  [DEBUG] Agendamento ignorado: vencimento(s) {[d.strftime('%d/%m %H:%M') for d in ocorrencias]} já reivindicado(s)/executado(s).", flush=True)
                continue

        gids = [g for g in (a.get("grupo_ids") or []) if g]
        eids = [e for e in (a.get("empresa_ids") or []) if e]
        if not gids and not eids:
            if debug:
                print("  [DEBUG] Agendamento ignorado: sem grupo_ids nem empresa_ids", flush=True)
            _atualizar_execucoes(exec_ids, "erro", erro="Agendamento sem grupo_ids nem empresa_ids", marcar_fim=True)
            continue

        api_tipos_raw = a.get("api_tipos") or ["clientes"]
        api_tipos = [t for t in api_tipos_raw if t in ("clientes", "categorias", "movimento_financeiro", "movimentos_geral", "pagamentos_realizados", "recebimentos_omie")]
        if not api_tipos:
            api_tipos = ["clientes"]

        label = _build_label_agendamento(supabase, gids, eids)
        data_de = (a.get("pagamentos_data_de") or "").strip() or None
        data_ate = (a.get("pagamentos_data_ate") or "").strip() or None
        jobs.append((label, gids, eids, api_tipos, data_de, data_ate, exec_ids))

    # LOG DETALHADO: jobs brutos por agendamento (apenas com SCHEDULER_DEBUG=1)
    if debug:
        print("  [DEBUG] Jobs bruto (por agendamento):", flush=True)
        for (label, gids, eids, api_tipos, data_de, data_ate, exec_ids) in jobs:
            print(
                f"    label={label!r} gids={gids} eids={eids} apis={api_tipos} pag_de={data_de!r} pag_ate={data_ate!r} execucoes={len(exec_ids)}",
                flush=True,
            )

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
            # limpar_pagamentos: True apenas no primeiro job de pagamentos do ciclo (apaga a tabela 1x).
            # Nos demais jobs de pagamentos do mesmo ciclo, False (não reapaga o que já foi inserido).
            limpar_pagamentos = job[6] if len(job) > 6 else True
            # exec_ids: execuções reivindicadas em api_agendamento_execucoes (status atualizado ao longo do job)
            exec_ids = job[7] if len(job) > 7 else []
            try:
                _atualizar_execucoes(exec_ids, "executando", marcar_inicio=True)
                supabase = _get_supabase()
                empresas = obter_empresas_para_sync(supabase, grupo_ids, empresa_ids)
                print(
                    f"  [DEBUG-WORKER] Executando job label={label!r} grupo_ids={grupo_ids} empresa_ids={empresa_ids} api_tipos={api_tipos}",
                    flush=True,
                )
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
                            supabase.rpc("refresh_dashboard_receber_apos_acessorias", {}).execute()
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
                            supabase.rpc("refresh_dashboard_receber_apos_acessorias", {}).execute()
                            print(f"  [{label}] Grupos/view inadimplentes atualizados.", flush=True)
                        except Exception as e:
                            print(f"  [{label}] Aviso: refresh grupos/dashboard: {e}", flush=True)
                    if "pagamentos_realizados" in api_tipos:
                        n = executar_sync_pagamentos_realizados_empresas(
                            supabase, empresas, label,
                            dDtPagtoDe=pagamentos_data_de,
                            dDtPagtoAte=pagamentos_data_ate,
                            limpar_antes=limpar_pagamentos,
                        )
                        total += n
                        print(f"  [{label}] Pagamentos realizados: {n} registros.", flush=True)
                        try:
                            supabase.rpc("refresh_view_concimed_pagamentos_realizados", {}).execute()
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
                _atualizar_execucoes(exec_ids, "sucesso", marcar_fim=True)
            except Exception as e:
                print(f"  [{label}] Erro: {e}", flush=True)
                _atualizar_execucoes(exec_ids, "erro", erro=str(e), marcar_fim=True)
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
    for label, gids, eids, api_tipos, data_de, data_ate, exec_ids in jobs:
        work_key = (tuple(sorted(gids or [])), tuple(sorted(eids or [])))
        if work_key not in jobs_unicos:
            jobs_unicos[work_key] = (label, gids, eids, set(api_tipos), data_de, data_ate, list(exec_ids))
        else:
            _, _, _, apis, cur_de, cur_ate, cur_execs = jobs_unicos[work_key]
            apis.update(api_tipos)
            cur_execs.extend(exec_ids)
            if "pagamentos_realizados" in api_tipos and (not cur_de or not cur_ate) and (data_de and data_ate):
                jobs_unicos[work_key] = (label, gids, eids, apis, data_de, data_ate, cur_execs)
            else:
                jobs_unicos[work_key] = (label, gids, eids, apis, cur_de, cur_ate, cur_execs)

    jobs_finais = []
    ordem_apis = ("clientes", "categorias", "movimento_financeiro", "movimentos_geral", "pagamentos_realizados", "recebimentos_omie")
    for work_key, (label, gids, eids, apis_set, data_de, data_ate, exec_ids) in jobs_unicos.items():
        api_tipos = [t for t in ordem_apis if t in apis_set]
        if not api_tipos:
            api_tipos = ["clientes"]
        jobs_finais.append((label, gids, eids, api_tipos, data_de, data_ate, exec_ids))

    if debug:
        print("  [DEBUG] Jobs unificados por (grupo_ids, empresa_ids):", flush=True)
        for (gids_key, eids_key), (label, gids, eids, apis_set, data_de, data_ate, exec_ids) in jobs_unicos.items():
            print(
                f"    work_key_gids={list(gids_key)} work_key_eids={list(eids_key)} label={label!r} apis_set={sorted(list(apis_set))} pag_de={data_de!r} pag_ate={data_ate!r} execucoes={len(exec_ids)}",
                flush=True,
            )

        print("  [DEBUG] Jobs finais (ordem interna de APIs aplicada):", flush=True)
        for (label, gids, eids, api_tipos, data_de, data_ate, exec_ids) in jobs_finais:
            print(
                f"    label={label!r} gids={gids} eids={eids} api_tipos_ordenados={api_tipos} pag_de={data_de!r} pag_ate={data_ate!r} execucoes={len(exec_ids)}",
                flush=True,
            )

    jobs_ordenados = sorted(jobs_finais, key=lambda x: x[0].lower())
    adicionados = 0
    # Apagar a tabela de pagamentos_realizados UMA ÚNICA VEZ por ciclo: só o primeiro job
    # de pagamentos enfileirado recebe limpar_pagamentos=True; os demais, False.
    pagamentos_ja_marcado_para_limpar = False
    for label, gids, eids, api_tipos, data_de, data_ate, exec_ids in jobs_ordenados:
        # Cooldown precisa considerar os tipos de API, senão um agendamento (ex.: pagamentos 04:30)
        # pode impedir outro do mesmo grupo (ex.: recebimentos 04:40).
        work_key = (
            tuple(sorted(gids or [])),
            tuple(sorted(eids or [])),
            tuple(api_tipos or []),
        )
        # Cooldown por work_key: só se aplica a jobs SEM execução reivindicada no banco
        # (com execução reivindicada, a UNIQUE de api_agendamento_execucoes já garante execução única).
        if not ignorar_horario and not exec_ids and work_key in ULTIMO_ADDED:
            decorrido = now_ts - ULTIMO_ADDED[work_key]
            if decorrido < COOLDOWN_SEGUNDOS:
                restante = COOLDOWN_SEGUNDOS - decorrido
                print(
                    f"  [{label}] Ignorado por cooldown: mesmo job (grupos/empresas/APIs) foi enfileirado há {decorrido // 60}min; aguarde {restante // 60 + 1}min.",
                    flush=True,
                )
                continue
        ULTIMO_ADDED[work_key] = now_ts
        # Este job vai limpar a tabela de pagamentos apenas se tiver pagamentos_realizados
        # e ainda não houve nenhum job de pagamentos marcado para limpar neste ciclo.
        if "pagamentos_realizados" in (api_tipos or []) and not pagamentos_ja_marcado_para_limpar:
            limpar_pagamentos = True
            pagamentos_ja_marcado_para_limpar = True
        else:
            limpar_pagamentos = False
        SYNC_QUEUE.put((label, gids, eids, api_tipos, data_de, data_ate, limpar_pagamentos, exec_ids))
        adicionados += 1

    if adicionados > 0:
        print(f"[{datetime.now(TZ).strftime('%H:%M:%S')}] {adicionados} job(s) adicionado(s) à fila (ordem: {', '.join(j[0] for j in jobs_ordenados)})", flush=True)


def preparar_registro_execucoes():
    """
    Chamada uma vez na inicialização do scheduler:
    1) Primeiro uso (tabela vazia): marca os vencimentos recentes como 'inicializacao', para o
       período anterior à criação do registro não ser executado retroativamente no deploy.
    2) Usos seguintes: reenfileira execuções 'pendente'/'executando' dentro da janela de
       recuperação — casos em que o processo caiu depois de reivindicar e antes de concluir.
    """
    try:
        supabase = _get_supabase()
        res = supabase.table("api_agendamento_execucoes").select("id").limit(1).execute()
    except Exception as e:
        if _ledger_indisponivel(e):
            _avisar_ledger_indisponivel(e)
        else:
            print(f"AVISO: não foi possível verificar o registro de execuções: {e}", flush=True)
        return

    agora = datetime.now(TZ)

    if not (res.data or []):
        try:
            ags = supabase.from_("api_agendamento").select("id, dias_semana, horarios").eq("ativo", True).execute()
            n = 0
            for a in ags.data or []:
                dias_int = []
                for d in a.get("dias_semana") or []:
                    try:
                        v = int(d)
                        if 1 <= v <= 7:
                            dias_int.append(v)
                    except (ValueError, TypeError):
                        pass
                horarios = [_normalizar_hora(str(h)) for h in (a.get("horarios") or []) if h]
                for dt in _ocorrencias_devidas(dias_int, horarios, agora):
                    if _reivindicar_execucao(supabase, a["id"], dt, status="inicializacao"):
                        n += 1
            print(f"Registro de execuções inicializado: {n} vencimento(s) recente(s) marcado(s) como 'inicializacao' (não executam retroativamente).", flush=True)
        except Exception as e:
            print(f"AVISO: falha ao inicializar registro de execuções: {e}", flush=True)
        return

    try:
        inicio_iso = (agora - timedelta(hours=JANELA_RECUPERACAO_HORAS)).astimezone(timezone.utc).isoformat()
        pend = (
            supabase.table("api_agendamento_execucoes")
            .select("id, agendamento_id, agendado_para, status")
            .in_("status", ["pendente", "executando"])
            .gte("agendado_para", inicio_iso)
            .execute()
        )
        rows = pend.data or []
        if not rows:
            return
        print(f"Recuperando {len(rows)} execução(ões) interrompida(s) (reivindicadas e não concluídas)...", flush=True)
        pagamentos_ja_marcado_para_limpar = False
        for row in rows:
            try:
                ag_res = supabase.from_("api_agendamento").select("*").eq("id", row["agendamento_id"]).limit(1).execute()
                ag = (ag_res.data or [None])[0]
                if not ag or not ag.get("ativo", True):
                    _atualizar_execucoes([row["id"]], "erro", erro="Agendamento não encontrado ou inativo na recuperação", marcar_fim=True)
                    continue
                gids = [g for g in (ag.get("grupo_ids") or []) if g]
                eids = [e for e in (ag.get("empresa_ids") or []) if e]
                if not gids and not eids:
                    _atualizar_execucoes([row["id"]], "erro", erro="Agendamento sem grupo_ids nem empresa_ids", marcar_fim=True)
                    continue
                api_tipos_raw = ag.get("api_tipos") or ["clientes"]
                api_tipos = [t for t in api_tipos_raw if t in ("clientes", "categorias", "movimento_financeiro", "movimentos_geral", "pagamentos_realizados", "recebimentos_omie")] or ["clientes"]
                label = _build_label_agendamento(supabase, gids, eids)
                data_de = (ag.get("pagamentos_data_de") or "").strip() or None
                data_ate = (ag.get("pagamentos_data_ate") or "").strip() or None
                if "pagamentos_realizados" in api_tipos and not pagamentos_ja_marcado_para_limpar:
                    limpar_pagamentos = True
                    pagamentos_ja_marcado_para_limpar = True
                else:
                    limpar_pagamentos = False
                SYNC_QUEUE.put((label, gids, eids, api_tipos, data_de, data_ate, limpar_pagamentos, [row["id"]]))
                print(f"  Reenfileirada: {label} (vencimento {row.get('agendado_para')}, status anterior: {row.get('status')})", flush=True)
            except Exception as e:
                print(f"  AVISO: falha ao recuperar execução {row.get('id')}: {e}", flush=True)
    except Exception as e:
        print(f"AVISO: falha na recuperação de execuções interrompidas: {e}", flush=True)


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

    if not forcar_agora:
        preparar_registro_execucoes()

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
        # Dormir até o início do próximo minuto (+1s de folga), em vez de 60s fixos.
        # Com sleep fixo, a checagem escorrega alguns segundos por ciclo e, quando cai
        # no fim do minuto (ex.: :58), a próxima pula um minuto inteiro — agendamentos
        # nesse minuto não disparam. Alinhando ao minuto, todo minuto é verificado.
        time.sleep(max(1.0, 60.0 - (time.time() % 60.0) + 1.0))


if __name__ == "__main__":
    main()
