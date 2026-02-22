"""Status em execução para exibição na tela de Logs."""
from datetime import datetime, timezone


def registrar_em_execucao(supabase, empresa_nome: str, api_tipo: str, job_label: str = ""):
    """Registra qual sync está sendo executado (para exibir na tela de Logs)."""
    try:
        supabase.table("api_sync_execucao_atual").upsert(
            {
                "id": 1,
                "empresa_nome": empresa_nome,
                "api_tipo": api_tipo,
                "job_label": job_label,
                "iniciado_em": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="id",
        ).execute()
    except Exception:
        pass


def limpar_em_execucao(supabase):
    """Remove o registro de execução atual."""
    try:
        supabase.table("api_sync_execucao_atual").delete().eq("id", 1).execute()
    except Exception:
        pass
