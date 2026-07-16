-- Registro (ledger) de execuções do scheduler.
-- Cada vencimento de agendamento vira UMA linha aqui; a UNIQUE (agendamento_id, agendado_para)
-- garante no banco que o mesmo vencimento nunca é executado duas vezes, e permite ao scheduler
-- recuperar execuções perdidas (rede fora do ar, restart, reboot da VPS) dentro da janela de recuperação.
-- Status: inicializacao | pendente | executando | sucesso | erro

create table if not exists public.api_agendamento_execucoes (
  id uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references public.api_agendamento(id) on delete cascade,
  agendado_para timestamptz not null,
  status text not null default 'pendente',
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  erro text,
  created_at timestamptz not null default now(),
  unique (agendamento_id, agendado_para)
);

create index if not exists idx_api_agendamento_execucoes_agendado_para
  on public.api_agendamento_execucoes (agendado_para desc);

create index if not exists idx_api_agendamento_execucoes_status
  on public.api_agendamento_execucoes (status);
