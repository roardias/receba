-- Regra: quando cliente_nome tiver o padrão "CODIGO - Nome" (ex.: "1623 - Vila Aracua Trancoso Spe Ltda"),
-- isolar o código em cod_cliente e deixar só o nome em cliente_nome.
-- 1) Ajuste nos registros existentes
-- 2) Trigger para INSERT/UPDATE

-- 1. Atualiza dados existentes: extrai código e nome
UPDATE cobrancas_realizadas
SET
  cod_cliente   = (regexp_match(cliente_nome, '^(\d+)\s*-\s*'))[1],
  cliente_nome  = trim(regexp_replace(cliente_nome, '^\d+\s*-\s*', ''))
WHERE cliente_nome ~ '^\d+\s*-\s*'
  AND trim(regexp_replace(cliente_nome, '^\d+\s*-\s*', '')) <> '';

-- 2. Função e trigger para novos saves
CREATE OR REPLACE FUNCTION public.receba_normaliza_cliente_nome_codigo()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cod TEXT;
  nome_limpo TEXT;
BEGIN
  IF NEW.cliente_nome IS NULL OR trim(NEW.cliente_nome) = '' THEN
    RETURN NEW;
  END IF;
  -- Padrão: "1623 - Nome" -> cod = 1623, nome_limpo = Nome
  cod := (regexp_match(NEW.cliente_nome, '^(\d+)\s*-\s*'))[1];
  IF cod IS NOT NULL THEN
    nome_limpo := trim(regexp_replace(NEW.cliente_nome, '^\d+\s*-\s*', ''));
    IF nome_limpo <> '' THEN
      NEW.cod_cliente   := cod;
      NEW.cliente_nome  := nome_limpo;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobrancas_realizadas_normaliza_cliente_nome_codigo ON public.cobrancas_realizadas;

CREATE TRIGGER trg_cobrancas_realizadas_normaliza_cliente_nome_codigo
  BEFORE INSERT OR UPDATE OF cliente_nome ON public.cobrancas_realizadas
  FOR EACH ROW
  EXECUTE FUNCTION public.receba_normaliza_cliente_nome_codigo();

COMMENT ON FUNCTION public.receba_normaliza_cliente_nome_codigo() IS 'Separa "CODIGO - Nome" em cod_cliente e cliente_nome em cobrancas_realizadas.';
