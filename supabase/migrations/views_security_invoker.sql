-- Segurança (fase 2): views passam a rodar com a permissão de QUEM CONSULTA
-- (security_invoker), em vez da permissão do dono — assim respeitam o RLS
-- ligado nas tabelas de base. Usuário logado continua vendo tudo; sem login, barrado.

alter view public.view_api_sync_log_brasilia set (security_invoker = true);
alter view public.view_controle_dividendos_ata_2025 set (security_invoker = true);

-- A view de dividendos lê a materialized view da Concimed; garante o SELECT
-- para usuários logados (materialized view não tem RLS, o acesso é por grant).
grant select on public.view_concimed_pagamentos_realizados to authenticated;
