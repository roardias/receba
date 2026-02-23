"""
Sync Recebimentos Omie (liquidados) → Supabase (recebimentos_omie).
Reutiliza api_omie_recebimentos. Credenciais vêm do Supabase (empresas.app_key, app_secret_encrypted).
Só insere linhas cujo chave_empresa_cliente existe em clientes (FK).
Logs em api_sync_log com api_tipo = recebimentos_omie.
"""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

from api_omie_recebimentos import listar_recebimentos_paginado

load_dotenv()

BATCH_SIZE = 100
API_TIPO = "recebimentos_omie"
# Nomes em minúsculas para bater com o schema do Postgres/Supabase (evita PGRST204)
CONFLICT_COLUMNS = "empresa_id,det_ncodtitulo"

# Mapeamento API → Supabase (só importar estes). chave_empresa_cliente = gerada no SQL.
# API: empresa → empresa; det_cCPFCNPJCliente → det_ccpfcnpjcliente; det_dDtPagamento → det_ddtpagamento;
# det_dDtPrevisao → det_ddtprevisao; det_nCodCliente → det_ncodcliente; det_nCodTitulo → det_ncodtitulo; res_nValPago → res_nvalpago
COLUNAS_TABELA = (
    "empresa",
    "empresa_id",
    "res_nvalpago",
    "det_ccpfcnpjcliente",
    "det_ddtpagamento",
    "det_ddtprevisao",
    "det_ncodtitulo",
    "det_ncodcliente",
)


def _parse_date(val) -> str | None:
    """Converte para ISO date (YYYY-MM-DD) ou None. Aceita DD/MM/YYYY ou YYYY-MM-DD."""
    if val is None or (isinstance(val, str) and not str(val).strip()):
        return None
    s = str(val).strip()
    if not s:
        return None
    # DD/MM/YYYY
    if "/" in s and len(s) >= 10:
        parts = s.split("/")
        if len(parts) == 3:
            try:
                d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
                if y < 100:
                    y += 2000
                return f"{y:04d}-{m:02d}-{d:02d}"
            except (ValueError, TypeError):
                pass
    # YYYY-MM-DD
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            y, m, d = int(s[:4]), int(s[5:7]), int(s[8:10])
            return f"{y:04d}-{m:02d}-{d:02d}"
        except (ValueError, TypeError):
            pass
    return None


def _qtde_dias(dt_pagamento: str | None, dt_previsao: str | None) -> int | None:
    """Retorna (dt_pagamento - dt_previsao) em dias, ou None se alguma data faltar."""
    if not dt_pagamento or not dt_previsao:
        return None
    try:
        from datetime import datetime as dt
        p = dt.strptime(dt_pagamento, "%Y-%m-%d").date()
        v = dt.strptime(dt_previsao, "%Y-%m-%d").date()
        return (p - v).days
    except (ValueError, TypeError):
        return None


def registrar_log(supabase, empresa_nome: str, status: str, registros: int = 0, mensagem_erro: str | None = None):
    agora = datetime.now(timezone.utc).isoformat()
    supabase.table("api_sync_log").insert({
        "empresa_nome": empresa_nome,
        "api_tipo": API_TIPO,
        "iniciado_em": agora,
        "finalizado_em": agora,
        "status": status,
        "registros_processados": registros,
        "mensagem_erro": mensagem_erro,
    }).execute()


def _arquivo_diagnostico_recebimentos() -> str:
    """Caminho do arquivo onde gravamos diagnóstico quando o scheduler não mostra o stdout."""
    base = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()
    return os.path.join(base, "recebimentos_sync_diagnostico.txt")


def _log_detalhe_api_recebimentos(nome: str, registros_raw: list, prefix: str, *, debug: bool = False, linhas_arquivo: list | None = None) -> None:
    """
    Log detalhado do que a API Omie retorna: chaves e valores que possam ser código do cliente.
    Se linhas_arquivo for passado, acumula as linhas para gravar em arquivo depois.
    """
    if not registros_raw:
        return
    prim = registros_raw[0]
    keys_suspeitas = [k for k in prim.keys() if "cod" in k.lower() or "cliente" in k.lower() or "codigo" in k.lower()]

    def out(s: str):
        print(f"{prefix}{s}", flush=True)
        if linhas_arquivo is not None:
            linhas_arquivo.append(s)

    # Sempre: resumo (total, chaves suspeitas, valor que o script usa)
    out(f"[API recebimentos] {nome!r} | registros: {len(registros_raw)} | chaves tipo cod/cliente: {keys_suspeitas}")
    cod_script = prim.get("det_nCodCliente") or prim.get("det_nCodcliente") or prim.get("det_ncodcliente")
    out(f"[API recebimentos] Valor usado pelo script (det_nCodCliente/...) no 1º reg.: {cod_script!r}")
    for k in keys_suspeitas:
        out(f"  {k!r} = {prim.get(k)!r}")

    if debug:
        out("[API recebimentos DEBUG] Todas as chaves do 1º registro:")
        for k in sorted(prim.keys()):
            out(f"  {k!r} = {prim[k]!r}")
        out("Valores cod/cliente nos primeiros 5 registros:")
        for i, r in enumerate(registros_raw[:5]):
            vals = {k: r.get(k) for k in keys_suspeitas if k in r}
            out(f"  reg[{i}] {vals}")


def _emitir_diagnostico_chaves(
    *,
    nome: str,
    empresa_id,
    use_nome: bool,
    chaves_set: set,
    chaves_api_encontradas: set,
    chaves_api_nao_encontradas: set,
    total_mov_api: int,
    cont_sem_codigo: int = 0,
    cont_rejeitado_cpf: int = 0,
    prefix: str,
    linhas_arquivo: list | None = None,
) -> None:
    """Emite log detalhado no console. Se linhas_arquivo for passado, acumula para gravar em arquivo."""
    linhas = []
    def log(s: str = ""):
        linhas.append(s)
        print(f"{prefix}[Recebimentos diagnóstico] {s}", flush=True)
        if linhas_arquivo is not None:
            linhas_arquivo.append(f"[Recebimentos diagnóstico] {s}")

    log(f"Empresa: {nome!r} | empresa_id: {empresa_id!r} | filtro no banco: {'empresa=nome_curto' if use_nome else 'empresa_id'}")
    log(f"Clientes no banco (esta empresa): {len(chaves_set)}")
    log(f"Mov. na API: {total_mov_api} | Chaves API que bateram: {len(chaves_api_encontradas)} | Chaves API que NÃO bateram: {len(chaves_api_nao_encontradas)}")
    if cont_sem_codigo > 0 or cont_rejeitado_cpf > 0:
        log(f"Motivo: {cont_sem_codigo} mov. sem código cliente (det_nCodCliente vazio); {cont_rejeitado_cpf} mov. rejeitados por CPF/CNPJ formatado.")
    if total_mov_api > 0 and len(chaves_api_encontradas) == 0 and len(chaves_api_nao_encontradas) == 0:
        log("Interpretação: todos os movimentos foram ignorados porque o código do cliente veio vazio (campo det_nCodCliente não preenchido ou nome do campo diferente na resposta da API). Veja o log [API recebimentos] acima para os nomes exatos dos campos.")
    log("")
    if chaves_set:
        amostra_db = sorted(chaves_set)[:25]
        log("Amostra de chaves no BANCO (clientes.chave_unica):")
        for c in amostra_db:
            log(f"  {c!r}")
        if len(chaves_set) > 25:
            log(f"  ... e mais {len(chaves_set) - 25}")
    log("")
    if chaves_api_nao_encontradas:
        amostra_nao = sorted(chaves_api_nao_encontradas)[:30]
        log("Amostra de chaves da API que NÃO existem no banco (formato montado: empresa_codigo):")
        for c in amostra_nao:
            log(f"  {c!r}")
        if len(chaves_api_nao_encontradas) > 30:
            log(f"  ... e mais {len(chaves_api_nao_encontradas) - 30}")
        log("")
        log("Possíveis causas: nome_curto da empresa diferente do campo empresa em clientes; código do cliente (det_nCodCliente) com formato diferente (ex.: zeros à esquerda).")
    if chaves_api_encontradas:
        log("")
        amostra_ok = sorted(chaves_api_encontradas)[:15]
        log("Amostra de chaves da API que BATERAM:")
        for c in amostra_ok:
            log(f"  {c!r}")

    # Gravar em arquivo quando RECEBIMENTOS_LOG/DEBUG ou quando chamado com linhas_arquivo (scheduler)
    if linhas_arquivo is not None or os.environ.get("RECEBIMENTOS_LOG", "").strip().lower() in ("1", "true", "yes") or os.environ.get("RECEBIMENTOS_DEBUG", "").strip().lower() in ("1", "true", "yes"):
        if linhas_arquivo is not None:
            # Foi acumulado em linhas_arquivo pelo caller; o caller grava o arquivo
            pass
        else:
            try:
                from datetime import datetime as dt
                safe_nome = "".join(c if c.isalnum() or c in " -_" else "_" for c in nome)[:50]
                path = os.path.join(os.path.dirname(__file__) or ".", f"recebimentos_diagnostico_{safe_nome}_{dt.now().strftime('%Y%m%d_%H%M%S')}.txt")
                with open(path, "w", encoding="utf-8") as f:
                    f.write("\n".join(linhas))
                print(f"{prefix}[Recebimentos diagnóstico] Relatório salvo em: {path}", flush=True)
            except Exception as e:
                print(f"{prefix}[Recebimentos diagnóstico] Erro ao salvar arquivo: {e}", flush=True)


def executar_sync_recebimentos_empresas(supabase, empresas: list[dict], label: str = "") -> int:
    """
    Executa sync de recebimentos (Omie ListarMovimentos CR, Liquidado=S) para recebimentos_omie.
    Empresas vêm do Supabase (id, nome_curto, app_key, app_secret) — mesma origem das outras APIs.
    Só insere linhas cujo chave_empresa_cliente existe em clientes (respeita FK).
    """
    from scheduler_status import limpar_em_execucao, registrar_em_execucao

    if not empresas:
        return 0

    # Chaves de clientes: pode ser empresa (nome) || '_' || codigo OU empresa_id (UUID) || '_' || codigo
    def carregar_chaves(offset: int, limit: int, **filtro) -> list:
        q = supabase.from_("clientes").select("chave_unica")
        for k, v in filtro.items():
            q = q.eq(k, v)
        res = q.range(offset, offset + limit - 1).execute()
        return [r["chave_unica"] for r in (res.data or []) if r.get("chave_unica")]

    def carregar_todas_chaves(nome_curto: str, empresa_id) -> tuple[set, dict, bool]:
        """
        Retorna (set de chave_unica, mapa chave_lower -> (empresa_real, codigo_real), use_nome).
        O mapa permite casar ignorando maiúsculas e usar no insert o valor exato de clientes.
        """
        out = set()
        limit = 1000
        # 1) Por empresa (nome_curto)
        try:
            offset = 0
            while True:
                batch = carregar_chaves(offset, limit, empresa=nome_curto)
                out.update(batch)
                if len(batch) < limit:
                    break
                offset += limit
            if out:
                lower_to_real = {}
                for chave in out:
                    # chave = "Empresa_Codigo" -> inserir com empresa e codigo exatamente como em clientes
                    if "_" in chave:
                        idx = chave.rfind("_")
                        empresa_real, codigo_real = chave[:idx], chave[idx + 1 :]
                        lower_to_real[chave.lower()] = (empresa_real, codigo_real)
                return out, lower_to_real, True
        except Exception:
            pass
        out = set()
        # 2) Fallback: por empresa_id
        try:
            offset = 0
            while True:
                batch = carregar_chaves(offset, limit, empresa_id=empresa_id)
                out.update(batch)
                if len(batch) < limit:
                    break
                offset += limit
            if out:
                lower_to_real = {}
                for chave in out:
                    if "_" in chave:
                        idx = chave.rfind("_")
                        empresa_real, codigo_real = chave[:idx], chave[idx + 1 :]
                        lower_to_real[chave.lower()] = (empresa_real, codigo_real)
                return out, lower_to_real, False
        except Exception:
            pass
        return out, {}, True

    total = 0
    prefix = f"  [{label}] " if label else "  "
    # Limpar arquivo de diagnóstico para esta execução (cada empresa com 0 linhas vai anexar)
    try:
        open(_arquivo_diagnostico_recebimentos(), "w", encoding="utf-8").close()
    except Exception:
        pass
    for emp in empresas:
        nome = (emp.get("nome_curto") or "").strip()
        empresa_id = emp["id"]
        app_key = emp["app_key"]
        app_secret = emp.get("app_secret") or ""
        if not (app_key and app_secret):
            print("ERRO: app_key ou app_secret vazio (verifique app_secret_encrypted e ENCRYPTION_KEY).", flush=True)
            registrar_log(supabase, nome, "erro", 0, "app_key ou app_secret vazio")
            limpar_em_execucao(supabase)
            continue
        chaves_set, chave_lower_to_empresa_codigo, use_nome = carregar_todas_chaves(nome, empresa_id)
        print(f"{prefix}Recebimentos {nome} (clientes={len(chaves_set)}, chave={'nome' if use_nome else 'id'})...", end=" ", flush=True)
        registrar_em_execucao(supabase, nome, API_TIPO, label)
        try:
            registros_raw, _ = listar_recebimentos_paginado(app_key, app_secret, nome, verbose=False)
            debug = os.environ.get("RECEBIMENTOS_DEBUG", "").strip().lower() in ("1", "true", "yes")
            # Log detalhado da API: sempre quando há registros, para inspecionar estrutura e nCodCliente
            _log_detalhe_api_recebimentos(nome, registros_raw, prefix, debug=debug)
            if debug and registros_raw:
                # Diagnóstico: o que veio da API vs o que está em clientes
                prim = registros_raw[0]
                keys_cod = [k for k in prim if "cod" in k.lower() and "cliente" in k.lower()]
                cod_val = prim.get("det_nCodCliente") or prim.get("det_nCodcliente") or prim.get("det_ncodcliente")
                amostra_chaves = sorted(chaves_set)[:5] if chaves_set else []
                chave_teste = f"{nome}_{(cod_val or '').strip()}" if cod_val else None
                print(f"\n  [DEBUG] 1ª linha API: keys com 'cod'+'cliente'={keys_cod}; valor_codigo={cod_val!r}", flush=True)
                print(f"  [DEBUG] clientes (amostra chave_unica): {amostra_chaves}", flush=True)
                print(f"  [DEBUG] chave montada 1º reg.: {chave_teste!r}; está em clientes? {chave_teste in chaves_set if chave_teste else False}", flush=True)
            rows = []
            def normalizar_codigo(cod: str) -> str:
                """Remove zeros à esquerda do código numérico."""
                if not cod:
                    return cod
                s = cod.strip()
                if s.isdigit():
                    return str(int(s))
                return s

            def cpf_cnpj_apenas_numeros(raw: str) -> tuple[str | None, bool]:
                """
                Extrai só dígitos do CPF/CNPJ para gravar no banco.
                Retorna (valor_só_dígitos, rejeitar_linha). Nunca rejeita por formatação (API Omie envia 08.789.633/0001-32).
                """
                if not raw or not str(raw).strip():
                    return None, False
                s = str(raw).strip()
                dig = "".join(c for c in s if c.isdigit())
                return (dig if dig else None), False

            # API Omie pode devolver nCodCliente com casing diferente no detalhe
            def _cod_cliente(row: dict):
                v = row.get("det_nCodCliente") or row.get("det_nCodcliente") or row.get("det_ncodcliente")
                return (v or "").strip()

            # Diagnóstico: chaves da API que não existem no banco (para log quando 0 linhas aceitas)
            chaves_api_nao_encontradas: set[str] = set()
            chaves_api_encontradas: set[str] = set()
            cont_sem_codigo = 0
            cont_rejeitado_cpf = 0

            for r in registros_raw:
                cpf_cnpj_val, rejeitar = cpf_cnpj_apenas_numeros(r.get("det_cCPFCNPJCliente") or r.get("det_ccpfcnpjcliente") or "")
                if rejeitar:
                    cont_rejeitado_cpf += 1
                    continue
                det_cod_cliente_raw = _cod_cliente(r)
                det_cod_cliente_norm = normalizar_codigo(det_cod_cliente_raw) or det_cod_cliente_raw
                if use_nome:
                    chave_norm = f"{nome}_{det_cod_cliente_norm}" if det_cod_cliente_norm else None
                    chave_raw = f"{nome}_{det_cod_cliente_raw}" if det_cod_cliente_raw else None
                else:
                    chave_norm = f"{empresa_id}_{det_cod_cliente_norm}" if det_cod_cliente_norm else None
                    chave_raw = f"{empresa_id}_{det_cod_cliente_raw}" if det_cod_cliente_raw else None
                if not chave_norm and not chave_raw:
                    cont_sem_codigo += 1
                    continue
                # Casamento: exato ou por minúsculas (para bater com clientes mesmo com diferença de casing)
                empresa_para_insert, codigo_para_insert = None, None
                if chave_norm in chaves_set or chave_raw in chaves_set:
                    chave_que_bateu = chave_norm if chave_norm in chaves_set else chave_raw
                    empresa_para_insert = nome if use_nome else str(empresa_id)
                    codigo_para_insert = det_cod_cliente_norm if chave_norm in chaves_set else det_cod_cliente_raw
                elif chave_lower_to_empresa_codigo:
                    for chave_teste in (chave_norm, chave_raw):
                        if chave_teste and chave_teste.lower() in chave_lower_to_empresa_codigo:
                            empresa_para_insert, codigo_para_insert = chave_lower_to_empresa_codigo[chave_teste.lower()]
                            break
                if empresa_para_insert is None or codigo_para_insert is None:
                    for ch in (chave_norm, chave_raw):
                        if ch:
                            chaves_api_nao_encontradas.add(ch)
                    continue
                for ch in (chave_norm, chave_raw):
                    if ch:
                        chaves_api_encontradas.add(ch)
                dt_pag = _parse_date(r.get("det_dDtPagamento"))
                dt_prev = _parse_date(r.get("det_dDtPrevisao"))
                rows.append({
                    "empresa": empresa_para_insert,
                    "empresa_id": empresa_id,
                    "res_nvalpago": r.get("res_nValPago") or 0,
                    "det_ccpfcnpjcliente": cpf_cnpj_val,
                    "det_ddtpagamento": dt_pag,
                    "det_ddtprevisao": dt_prev,
                    "det_ncodtitulo": (r.get("det_nCodTitulo") or "").strip() or None,
                    "det_ncodcliente": codigo_para_insert,
                })
            if not rows:
                msg = f"API: {len(registros_raw)} mov.; clientes no banco: {len(chaves_set)}"
                if not chaves_set:
                    msg += " (nenhum cliente para esta empresa no banco?)"
                elif len(registros_raw) > 0:
                    msg += " (chaves não bateram?)"
                print(f"0 ({msg})", flush=True)
                # Diagnóstico detalhado + gravar em arquivo (para ver mesmo quando o scheduler não mostra stdout)
                linhas_arquivo = [
                    f"=== Recebimentos Omie - diagnóstico {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC ===",
                    f"Empresa: {nome!r}",
                    "",
                ]
                _log_detalhe_api_recebimentos(nome, registros_raw, prefix, debug=debug, linhas_arquivo=linhas_arquivo)
                _emitir_diagnostico_chaves(
                    nome=nome,
                    empresa_id=empresa_id,
                    use_nome=use_nome,
                    chaves_set=chaves_set,
                    chaves_api_encontradas=chaves_api_encontradas,
                    chaves_api_nao_encontradas=chaves_api_nao_encontradas,
                    total_mov_api=len(registros_raw),
                    cont_sem_codigo=cont_sem_codigo,
                    cont_rejeitado_cpf=cont_rejeitado_cpf,
                    prefix=prefix,
                    linhas_arquivo=linhas_arquivo,
                )
                try:
                    path = _arquivo_diagnostico_recebimentos()
                    with open(path, "a", encoding="utf-8") as f:
                        f.write("\n".join(linhas_arquivo))
                        f.write("\n\n")
                    print(f"{prefix}Diagnóstico gravado em: {path}", flush=True)
                except Exception as e:
                    print(f"{prefix}Erro ao gravar diagnóstico: {e}", flush=True)
                registrar_log(supabase, nome, "sucesso", 0, msg)
                continue
            n = upsert_batch(supabase, rows)
            registrar_log(supabase, nome, "sucesso", n)
            total += n
            print(n, flush=True)
        except Exception as e:
            print(f"ERRO: {e}", flush=True)
            registrar_log(supabase, nome, "erro", 0, str(e))
        finally:
            limpar_em_execucao(supabase)
    return total


def upsert_batch(supabase, rows: list[dict]) -> int:
    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = [{k: v for k, v in r.items() if k in COLUNAS_TABELA} for r in rows[i : i + BATCH_SIZE]]
        supabase.table("recebimentos_omie").upsert(batch, on_conflict=CONFLICT_COLUMNS).execute()
        total += len(batch)
    return total


def _main_recebimentos():
    """Permite rodar o sync direto: python sync_recebimentos_supabase.py. Respeita cada agendamento (empresa_ids ou grupo_ids)."""
    url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    if not url or not key:
        print("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou SUPABASE_KEY) no .env", flush=True)
        return 1
    supabase = create_client(url, key)
    from scheduler_sync import obter_empresas_para_sync, _build_label_agendamento
    # Buscar agendamentos que têm recebimentos_omie (sem juntar todos)
    try:
        res = supabase.from_("api_agendamento").select("grupo_ids, empresa_ids, api_tipos").eq("ativo", True).execute()
    except Exception:
        res = type("R", (), {"data": []})()
    jobs_receb = []
    for a in res.data or []:
        tipos = a.get("api_tipos") or []
        if "recebimentos_omie" not in tipos:
            continue
        gids = list(a.get("grupo_ids") or [])
        eids = list(a.get("empresa_ids") or [])
        jobs_receb.append((gids, eids))
    # Coalesce: mesmo (gids, eids) = um job só
    unicos = {}
    for gids, eids in jobs_receb:
        key_job = (tuple(sorted(gids)), tuple(sorted(eids)))
        if key_job not in unicos:
            unicos[key_job] = (gids, eids)
    if not unicos:
        print("Nenhum agendamento ativo com Recebimentos Omie.", flush=True)
        return 1
    path_diag = _arquivo_diagnostico_recebimentos()
    print(f"Se houver 0 linhas aceitas, diagnóstico será gravado em: {path_diag}", flush=True)
    total_registros = 0
    for (gids, eids) in unicos.values():
        empresas = obter_empresas_para_sync(supabase, gids, eids)
        if not empresas:
            continue
        label = _build_label_agendamento(supabase, gids, eids)
        origem = "empresa_ids" if eids else "grupo_ids"
        print(f"Executando Recebimentos Omie para [{label}] — {len(empresas)} empresa(s) (agendamento por {origem}).", flush=True)
        n = executar_sync_recebimentos_empresas(supabase, empresas, label)
        total_registros += n
    print(f"Total: {total_registros} registros.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(_main_recebimentos())
