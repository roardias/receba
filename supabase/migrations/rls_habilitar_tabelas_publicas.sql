-- Segurança: liga RLS nas tabelas que estavam sem proteção e cria a regra
-- "usuário logado (authenticated) pode tudo" — mesmo comportamento de hoje para
-- quem usa o sistema, mas fecha o banco para a chave anon sem login.
-- O scheduler da VPS usa a chave service_role, que ignora RLS (não é afetado).
-- Rollback por tabela, se necessário:
--   alter table public.NOME_DA_TABELA disable row level security;

-- 1) Ligar RLS + regra de usuário logado nas tabelas sem proteção
do $$
declare t text;
begin
  foreach t in array array[
    'api_agendamento',
    'api_sync_execucao_atual',
    'api_sync_log',
    'categorias',
    'clientes',
    'dividendos_ata_2025',
    'empresas',
    'empresas_grupo_basal',
    'grupos',
    'medico_ir_retido',
    'movimentos',
    'pagamentos_realizados',
    'perfis_permissoes',
    'recebimentos_omie',
    'status_cobranca',
    'titulos_a_vencer',
    'titulos_pagos'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Autenticados ALL %s" on public.%I', t, t);
    execute format(
      'create policy "Autenticados ALL %s" on public.%I for all to authenticated using (true) with check (true)',
      t, t
    );
  end loop;
end $$;

-- 2) recebimentos_omie: remover as regras da chave pública (anon) — eram para o
-- scheduler antigo; com service_role na VPS não são necessárias e deixavam a porta aberta.
drop policy if exists "Anon INSERT recebimentos_omie" on public.recebimentos_omie;
drop policy if exists "Anon UPDATE recebimentos_omie" on public.recebimentos_omie;

-- 3) acessorias: trocar "Permitir todos" (inclusive sem login) por "somente logados".
-- A tela de importação usa usuário logado, então nada muda para o sistema.
drop policy if exists "Permitir todos em acessorias" on public.acessorias;
drop policy if exists "Autenticados ALL acessorias" on public.acessorias;
create policy "Autenticados ALL acessorias" on public.acessorias
  for all to authenticated using (true) with check (true);

-- 4) api_agendamento_execucoes: RLS já estava ativo, mas sem regra para o site
-- (só o service_role acessava). Garante leitura/escrita para usuários logados.
drop policy if exists "Autenticados ALL api_agendamento_execucoes" on public.api_agendamento_execucoes;
create policy "Autenticados ALL api_agendamento_execucoes" on public.api_agendamento_execucoes
  for all to authenticated using (true) with check (true);
