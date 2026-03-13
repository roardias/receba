-- Tabela de tipos de status de cobrança (controle centralizado; frontend consome daqui).
-- Novos status: inserir nesta tabela; não é mais necessário alterar CHECK nem código da interface.

CREATE TABLE IF NOT EXISTS status_cobranca (
  codigo TEXT NOT NULL PRIMARY KEY,
  label TEXT NOT NULL,
  ordem INT NOT NULL DEFAULT 0
);

COMMENT ON TABLE status_cobranca IS 'Tipos de status de cobrança. Ordem define exibição em filtros e dropdowns.';

-- Seed com os status atuais (ordem de exibição desejada)
INSERT INTO status_cobranca (codigo, label, ordem) VALUES
  ('em_cobranca', 'Em cobrança', 1),
  ('negociado_pagamento', 'Negociado pagamento', 2),
  ('nao_cumpriu_promessa_pagamento', 'Não cumpriu promessa de pagamento', 3),
  ('bloqueado', 'Bloqueado', 4),
  ('protestado', 'Protestado', 5),
  ('em_acao_judicial', 'Em ação judicial', 6)
ON CONFLICT (codigo) DO NOTHING;

-- Remover CHECK antigo de cliente_status e referenciar a tabela de tipos
ALTER TABLE cliente_status DROP CONSTRAINT IF EXISTS cliente_status_status_check;
ALTER TABLE cliente_status
  ADD CONSTRAINT fk_cliente_status_status
  FOREIGN KEY (status) REFERENCES status_cobranca(codigo);

COMMENT ON CONSTRAINT fk_cliente_status_status ON cliente_status IS 'Status deve existir em status_cobranca. Incluir novo tipo apenas na tabela status_cobranca.';

-- Permissão para leitura pela aplicação (RLS opcional; tabela de catálogo costuma ser só leitura)
GRANT SELECT ON status_cobranca TO authenticated;
GRANT SELECT ON status_cobranca TO service_role;
GRANT SELECT ON status_cobranca TO anon;
