-- Registro de cobranças realizadas: E-mail (automático), Ligação e WhatsApp
-- Cada "envio" pode ter várias linhas (uma por cod. cliente) com o mesmo registro_id

CREATE TABLE IF NOT EXISTS cobrancas_realizadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registro_id UUID NOT NULL DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL CHECK (tipo IN ('email', 'ligacao', 'whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Contexto (cliente/grupo) — uma linha por cod. cliente no mesmo envio
  cod_cliente TEXT,
  cnpj_cpf TEXT,
  cliente_nome TEXT,
  grupo_nome TEXT,
  empresas_internas_nomes TEXT,

  -- E-mail (preenchido automaticamente no envio)
  emails_destinatarios TEXT,
  email_remetente TEXT,

  -- Ligação
  foi_atendido BOOLEAN,
  nome_pessoa TEXT,
  cargo_pessoa TEXT,
  houve_negociacao BOOLEAN,
  observacao_nao_negociacao TEXT,
  data_prevista_pagamento DATE,
  houve_desconto BOOLEAN,
  valor_desconto NUMERIC(12,2),
  motivo_desconto TEXT,

  -- Observação (comum)
  observacao TEXT,

  -- WhatsApp
  mensagem_whatsapp_enviada TEXT,
  nome_quem_conversou TEXT,
  cargo_quem_conversou TEXT
);

CREATE INDEX idx_cobrancas_realizadas_registro_id ON cobrancas_realizadas(registro_id);
CREATE INDEX idx_cobrancas_realizadas_tipo ON cobrancas_realizadas(tipo);
CREATE INDEX idx_cobrancas_realizadas_created_at ON cobrancas_realizadas(created_at DESC);
CREATE INDEX idx_cobrancas_realizadas_cod_cliente ON cobrancas_realizadas(cod_cliente);

COMMENT ON TABLE cobrancas_realizadas IS 'Registro de cobranças: e-mail (automático), ligação e WhatsApp. registro_id agrupa linhas do mesmo envio.';
COMMENT ON COLUMN cobrancas_realizadas.registro_id IS 'Mesmo valor para todas as linhas do mesmo envio (ex.: um e-mail para vários clientes).';
