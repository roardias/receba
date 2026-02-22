-- Datas de pagamento para a API Pagamentos Realizados (solicitadas ao criar/editar o agendamento)

ALTER TABLE api_agendamento
  ADD COLUMN IF NOT EXISTS pagamentos_data_de TEXT,
  ADD COLUMN IF NOT EXISTS pagamentos_data_ate TEXT;

COMMENT ON COLUMN api_agendamento.pagamentos_data_de IS 'Data inicial (DD/MM/AAAA) para API Pagamentos Realizados. Obrigatório quando api_tipos inclui pagamentos_realizados.';
COMMENT ON COLUMN api_agendamento.pagamentos_data_ate IS 'Data final (DD/MM/AAAA) para API Pagamentos Realizados. Obrigatório quando api_tipos inclui pagamentos_realizados.';
