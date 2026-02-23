-- Preenchimento automático no SQL: qtde_dias = det_ddtpagamento - det_ddtprevisao (em dias).
-- empresa continua sendo enviada pelo import (não usa trigger).

ALTER TABLE recebimentos_omie DROP COLUMN IF EXISTS qtde_dias;
ALTER TABLE recebimentos_omie
  ADD COLUMN qtde_dias INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN det_ddtpagamento IS NOT NULL AND det_ddtprevisao IS NOT NULL
      THEN (det_ddtpagamento::date - det_ddtprevisao::date)
      ELSE NULL
    END
  ) STORED;

COMMENT ON COLUMN recebimentos_omie.qtde_dias IS 'Diferença em dias: det_ddtpagamento - det_ddtprevisao (preenchido automaticamente).';
