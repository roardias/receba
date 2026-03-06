-- Padroniza grupo_nome em cobrancas_realizadas: primeira letra de cada palavra maiúscula, demais minúsculas.
-- 1) Ajuste nos registros existentes
-- 2) Trigger para todo INSERT/UPDATE

-- 1. Atualiza dados existentes
UPDATE cobrancas_realizadas
SET grupo_nome = initcap(lower(trim(grupo_nome)))
WHERE grupo_nome IS NOT NULL
  AND trim(grupo_nome) <> '';

-- 2. Função e trigger para novos saves (schema public explícito para evitar "function does not exist")
CREATE OR REPLACE FUNCTION public.receba_normaliza_grupo_nome_text(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
           WHEN p_text IS NULL OR trim(p_text) = '' THEN p_text
           ELSE initcap(lower(trim(p_text)))
         END;
$$;

CREATE OR REPLACE FUNCTION public.receba_trg_cobrancas_normaliza_grupo_nome()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.grupo_nome := public.receba_normaliza_grupo_nome_text(NEW.grupo_nome);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobrancas_realizadas_normaliza_grupo_nome ON public.cobrancas_realizadas;

CREATE TRIGGER trg_cobrancas_realizadas_normaliza_grupo_nome
  BEFORE INSERT OR UPDATE OF grupo_nome ON public.cobrancas_realizadas
  FOR EACH ROW
  EXECUTE FUNCTION public.receba_trg_cobrancas_normaliza_grupo_nome();

COMMENT ON FUNCTION public.receba_normaliza_grupo_nome_text(TEXT) IS 'Normaliza nome de grupo: initcap(lower(trim)). Usado em cobrancas_realizadas.grupo_nome.';
