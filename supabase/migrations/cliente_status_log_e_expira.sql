-- 1. Tabela de log de alterações de status (para relatórios e acompanhamento do cliente)
CREATE TABLE IF NOT EXISTS cliente_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_cliente TEXT NOT NULL,
  status_anterior TEXT NULL,
  status_novo TEXT NOT NULL,
  data_negociado_anterior DATE NULL,
  data_negociado_novo DATE NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID NULL
);

CREATE INDEX IF NOT EXISTS idx_cliente_status_log_chave ON cliente_status_log(chave_cliente);
CREATE INDEX IF NOT EXISTS idx_cliente_status_log_created ON cliente_status_log(created_at);
CREATE INDEX IF NOT EXISTS idx_cliente_status_log_status_novo ON cliente_status_log(status_novo);

COMMENT ON TABLE cliente_status_log IS 'Log de alterações de status de cobrança. Permite relatórios e acompanhamento do comportamento do cliente.';

-- 2. Adicionar novo status: nao_cumpriu_promessa_pagamento (quando data de negociação expira)
ALTER TABLE cliente_status DROP CONSTRAINT IF EXISTS cliente_status_status_check;
ALTER TABLE cliente_status ADD CONSTRAINT cliente_status_status_check CHECK (status IN (
  'em_cobranca',
  'negociado_pagamento',
  'bloqueado',
  'protestado',
  'em_acao_judicial',
  'nao_cumpriu_promessa_pagamento'
));

-- 3. Trigger: registrar em cliente_status_log em todo INSERT/UPDATE em cliente_status
CREATE OR REPLACE FUNCTION fn_cliente_status_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO cliente_status_log (chave_cliente, status_anterior, status_novo, data_negociado_anterior, data_negociado_novo, updated_by)
    VALUES (NEW.chave_cliente, NULL, NEW.status, NULL, NEW.data_negociado, NEW.updated_by);
  ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.data_negociado IS DISTINCT FROM NEW.data_negociado) THEN
    INSERT INTO cliente_status_log (chave_cliente, status_anterior, status_novo, data_negociado_anterior, data_negociado_novo, updated_by)
    VALUES (NEW.chave_cliente, OLD.status, NEW.status, OLD.data_negociado, NEW.data_negociado, NEW.updated_by);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_status_log ON cliente_status;
CREATE TRIGGER trg_cliente_status_log
  AFTER INSERT OR UPDATE ON cliente_status
  FOR EACH ROW
  EXECUTE PROCEDURE fn_cliente_status_log();

-- 4. Função: expirar negociados cuja data_negociado já passou -> status 'nao_cumpriu_promessa_pagamento'
CREATE OR REPLACE FUNCTION expirar_negociados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  n integer;
BEGIN
  WITH atualizados AS (
    UPDATE cliente_status
    SET status = 'nao_cumpriu_promessa_pagamento',
        data_negociado = NULL,
        updated_at = now(),
        updated_by = NULL
    WHERE status = 'negociado_pagamento'
      AND data_negociado IS NOT NULL
      AND data_negociado < CURRENT_DATE
    RETURNING chave_cliente
  )
  SELECT count(*)::integer INTO n FROM atualizados;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION expirar_negociados() IS 'Atualiza status de negociado_pagamento para nao_cumpriu_promessa_pagamento quando data_negociado < hoje. Retorna quantidade atualizada. O trigger em cliente_status registra no log.';
