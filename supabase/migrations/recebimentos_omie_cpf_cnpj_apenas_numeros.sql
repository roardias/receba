-- CPF/CNPJ: apenas dígitos no banco. Se vier . / ou - na origem, o sync não importa a linha.
-- Coluna no PG é det_ccpfcnpjcliente (minúsculas); constraint só aceita dígitos.

ALTER TABLE recebimentos_omie DROP CONSTRAINT IF EXISTS chk_recebimentos_omie_cpf_cnpj_digitos;
ALTER TABLE recebimentos_omie
  ADD CONSTRAINT chk_recebimentos_omie_cpf_cnpj_digitos
  CHECK (det_ccpfcnpjcliente IS NULL OR det_ccpfcnpjcliente ~ '^[0-9]*$');

COMMENT ON COLUMN recebimentos_omie.det_ccpfcnpjcliente IS 'CPF/CNPJ do cliente - apenas dígitos. Linhas com . / ou - na origem não são importadas.';
