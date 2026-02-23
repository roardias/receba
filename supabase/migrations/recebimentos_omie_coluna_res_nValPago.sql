-- Usar o mesmo nome que vem após o tratamento da API: res_nValPago (em vez de ValPago_validado)

ALTER TABLE recebimentos_omie RENAME COLUMN "ValPago_validado" TO res_nValPago;

COMMENT ON COLUMN recebimentos_omie.res_nValPago IS 'Valor pago (resumo API, após tratamento: res_nValPago).';
