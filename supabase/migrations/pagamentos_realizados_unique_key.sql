-- Permite várias linhas por título: mesmo título pode ter vários pagamentos (baixas diferentes).
-- Chave única: empresa + título + categ + dept + cliente + det_nCodBaixa (código da baixa na Omie).

ALTER TABLE pagamentos_realizados
  ADD COLUMN IF NOT EXISTS det_ncodbaixa TEXT;

ALTER TABLE pagamentos_realizados
  DROP CONSTRAINT IF EXISTS pagamentos_realizados_empresa_titulo_categ_dept_key;

ALTER TABLE pagamentos_realizados
  DROP CONSTRAINT IF EXISTS pagamentos_realizados_uniq;

ALTER TABLE pagamentos_realizados
  ADD CONSTRAINT pagamentos_realizados_uniq
  UNIQUE (empresa, det_ncodtitulo, categ_validada, dept_cod, det_ncodcliente, det_ncodbaixa);

COMMENT ON COLUMN pagamentos_realizados.det_ncodbaixa IS 'Código da baixa (nCodBaixa) na Omie; identifica a linha de pagamento.';
COMMENT ON CONSTRAINT pagamentos_realizados_uniq ON pagamentos_realizados IS
  'Uma linha por combinação empresa+título+categ+dept+cliente+código baixa (permite valor repetido).';
