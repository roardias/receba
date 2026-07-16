-- Função para esvaziar a tabela pagamentos_realizados de forma imediata (TRUNCATE),
-- substituindo o DELETE via PostgREST que estourava o timeout do cliente (5s) em tabelas grandes
-- e deixava a tabela vazia quando o job era abortado no meio.
-- Uso pelo sync: supabase.rpc('truncate_pagamentos_realizados')

create or replace function public.truncate_pagamentos_realizados()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  truncate table public.pagamentos_realizados;
end;
$$;

grant execute on function public.truncate_pagamentos_realizados() to anon, authenticated, service_role;
