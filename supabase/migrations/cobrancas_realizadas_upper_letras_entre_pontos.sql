-- Letras entre pontos em maiúsculas: "G.s.i." -> "G.S.I."
-- 1) Função reutilizável
-- 2) Ajuste em cliente_nome existente
-- 3) Trigger de normalização passa a aplicar essa regra também

-- 1. Função: uppercase em cada letra entre pontos (ex.: .s. -> .S.)
CREATE OR REPLACE FUNCTION public.receba_upper_letras_entre_pontos(t text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  r text;
  i int;
  c text;
BEGIN
  IF t IS NULL OR trim(t) = '' THEN
    RETURN t;
  END IF;
  r := t;
  FOR i IN 1..26 LOOP
    c := chr(ascii('a') + i - 1);
    r := regexp_replace(r, '\.' || c || '\.', '.' || upper(c) || '.', 'g');
  END LOOP;
  RETURN r;
END;
$$;

COMMENT ON FUNCTION public.receba_upper_letras_entre_pontos(text) IS 'Coloca em maiúscula letras entre pontos: G.s.i. -> G.S.I.';

-- 2. Atualiza cliente_nome onde houver letra minúscula entre pontos
UPDATE cobrancas_realizadas
SET cliente_nome = public.receba_upper_letras_entre_pontos(cliente_nome)
WHERE cliente_nome ~ '\.([a-z])\.';

-- 3. Trigger de normalização: aplicar também a regra de maiúsculas entre pontos
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
  -- Padrão "1623 - Nome" -> cod_cliente = 1623, cliente_nome = Nome
  cod := (regexp_match(NEW.cliente_nome, '^(\d+)\s*-\s*'))[1];
  IF cod IS NOT NULL THEN
    nome_limpo := trim(regexp_replace(NEW.cliente_nome, '^\d+\s*-\s*', ''));
    IF nome_limpo <> '' THEN
      NEW.cod_cliente   := cod;
      NEW.cliente_nome  := nome_limpo;
    END IF;
  END IF;
  -- Letras entre pontos em maiúsculas: G.s.i. -> G.S.I.
  NEW.cliente_nome := public.receba_upper_letras_entre_pontos(NEW.cliente_nome);
  RETURN NEW;
END;
$$;
