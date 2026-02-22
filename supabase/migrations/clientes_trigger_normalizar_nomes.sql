-- Trigger: normaliza razao_social e nome_fantasia em clientes em todo INSERT e UPDATE (importações e alterações).
-- Regra: INITCAP(TRIM(...)) — primeira letra de cada palavra maiúscula, demais minúsculas.

CREATE OR REPLACE FUNCTION clientes_normalizar_nomes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.razao_social IS NOT NULL AND TRIM(NEW.razao_social) != '' THEN
    NEW.razao_social := INITCAP(TRIM(NEW.razao_social));
  END IF;
  IF NEW.nome_fantasia IS NOT NULL AND TRIM(NEW.nome_fantasia) != '' THEN
    NEW.nome_fantasia := INITCAP(TRIM(NEW.nome_fantasia));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_normalizar_nomes ON clientes;
CREATE TRIGGER trg_clientes_normalizar_nomes
  BEFORE INSERT OR UPDATE OF razao_social, nome_fantasia
  ON clientes
  FOR EACH ROW
  EXECUTE PROCEDURE clientes_normalizar_nomes();

COMMENT ON FUNCTION clientes_normalizar_nomes() IS 'Normaliza razao_social e nome_fantasia (INITCAP) em clientes para todas as importações e atualizações.';
