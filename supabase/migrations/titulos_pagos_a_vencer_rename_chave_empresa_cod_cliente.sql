-- Renomeia chave_empresa_titulo -> chave_empresa_cod_cliente (tabelas já criadas)

ALTER TABLE public.titulos_pagos
  RENAME COLUMN chave_empresa_titulo TO chave_empresa_cod_cliente;

ALTER TABLE public.titulos_a_vencer
  RENAME COLUMN chave_empresa_titulo TO chave_empresa_cod_cliente;
