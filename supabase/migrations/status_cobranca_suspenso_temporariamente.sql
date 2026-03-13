-- Novo status de cobrança: Suspenso Temporariamente
INSERT INTO status_cobranca (codigo, label, ordem) VALUES
  ('suspenso_temporariamente', 'Suspenso Temporariamente', 7)
ON CONFLICT (codigo) DO NOTHING;
