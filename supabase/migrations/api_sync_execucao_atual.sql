-- Tabela para exibir na tela de Logs o que está sendo executado no momento
-- O scheduler preenche ao iniciar cada sync e limpa ao terminar
-- Execute no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS api_sync_execucao_atual (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  empresa_nome TEXT,
  api_tipo TEXT,
  job_label TEXT,
  iniciado_em TIMESTAMPTZ DEFAULT now()
);
