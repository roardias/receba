-- Correção: trigger não pode usar NEW.codigo_nome_fantasia em BEFORE (coluna gerada
-- é calculada depois do trigger). Usar o código extraído de NEW.nome_fantasia.
-- Evita que acessoria_id fique NULL/errado após sync de clientes pela API e
-- que os grupos sumam na Relação inadimplentes.

CREATE OR REPLACE FUNCTION clientes_sync_acessoria_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  codigo TEXT;
  aid UUID;
BEGIN
  codigo := (regexp_match(NEW.nome_fantasia, '^(\d+)\s*-\s*'))[1]::TEXT;
  IF codigo IS NOT NULL AND codigo != '' THEN
    SELECT a.id INTO aid FROM acessorias a WHERE a.id_planilha = codigo LIMIT 1;
    NEW.acessoria_id := aid;
  ELSE
    NEW.acessoria_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION clientes_sync_acessoria_id() IS 'Preenche acessoria_id a partir de nome_fantasia (código antes de " - "). Usa nome_fantasia pois codigo_nome_fantasia é gerada e não está disponível no BEFORE trigger.';
