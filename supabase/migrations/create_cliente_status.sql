-- Status de cobrança por cliente (chave_cliente = empresa + cod_cliente)
-- Valores: em_cobranca (padrão), negociado_pagamento, bloqueado, protestado, em_acao_judicial
-- Novos códigos em movimentos entram com status padrão via trigger

CREATE TABLE IF NOT EXISTS cliente_status (
  chave_cliente TEXT NOT NULL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'em_cobranca' CHECK (status IN (
    'em_cobranca',
    'negociado_pagamento',
    'bloqueado',
    'protestado',
    'em_acao_judicial'
  )),
  data_negociado DATE NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID NULL
);

COMMENT ON TABLE cliente_status IS 'Status de cobrança por cliente. Grupo = empresas clientes (grupo_empresas). Novos chave_cliente em movimentos entram com em_cobranca.';
COMMENT ON COLUMN cliente_status.data_negociado IS 'Preenchido quando status = negociado_pagamento (data acordada para pagamento).';

CREATE INDEX IF NOT EXISTS idx_cliente_status_status ON cliente_status(status);

-- Inserir status padrão para novos chave_cliente ao inserir em movimentos
CREATE OR REPLACE FUNCTION fn_cliente_status_on_movimento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.chave_cliente IS NOT NULL AND trim(NEW.chave_cliente) != '' THEN
    INSERT INTO cliente_status (chave_cliente, status)
    VALUES (NEW.chave_cliente, 'em_cobranca')
    ON CONFLICT (chave_cliente) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_status_on_movimento ON movimentos;
CREATE TRIGGER trg_cliente_status_on_movimento
  AFTER INSERT ON movimentos
  FOR EACH ROW
  EXECUTE PROCEDURE fn_cliente_status_on_movimento();

-- Backfill: inserir em_cobranca para todos chave_cliente existentes em movimentos que ainda não estão em cliente_status
CREATE OR REPLACE FUNCTION backfill_cliente_status()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  INSERT INTO cliente_status (chave_cliente, status)
  SELECT DISTINCT m.chave_cliente, 'em_cobranca'
  FROM movimentos m
  WHERE m.chave_cliente IS NOT NULL AND trim(m.chave_cliente) != ''
  ON CONFLICT (chave_cliente) DO NOTHING;
$$;

COMMENT ON FUNCTION backfill_cliente_status() IS 'Chamar após carga inicial de movimentos para preencher cliente_status. Novos registros já entram via trigger.';
