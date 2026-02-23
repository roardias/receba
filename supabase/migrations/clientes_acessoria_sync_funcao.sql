-- Sincroniza clientes.acessoria_id com acessorias por código (id_planilha = codigo_nome_fantasia).
-- O trigger só dispara em INSERT/UPDATE de nome_fantasia; quando acessorias é importada depois,
-- clientes já existentes não têm acessoria_id preenchido. Esta função corrige em massa e pode
-- ser chamada após import de acessorias ou por cron.

CREATE OR REPLACE FUNCTION sync_clientes_acessoria_id()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  WITH match AS (
    SELECT c.chave_unica, a.id AS acessoria_id
    FROM clientes c
    INNER JOIN acessorias a ON a.id_planilha = c.codigo_nome_fantasia
    WHERE c.codigo_nome_fantasia IS NOT NULL AND c.codigo_nome_fantasia != ''
  )
  UPDATE clientes c
  SET acessoria_id = match.acessoria_id
  FROM match
  WHERE c.chave_unica = match.chave_unica
    AND (c.acessoria_id IS DISTINCT FROM match.acessoria_id);

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- Opcional: limpar acessoria_id onde o código não existe mais em acessorias
  UPDATE clientes c
  SET acessoria_id = NULL
  WHERE c.acessoria_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM acessorias a
      WHERE a.id = c.acessoria_id
    );

  RETURN updated_count;
END;
$$;

COMMENT ON FUNCTION sync_clientes_acessoria_id() IS 'Preenche clientes.acessoria_id por id_planilha = codigo_nome_fantasia. Chamar após import de acessorias.';

GRANT EXECUTE ON FUNCTION sync_clientes_acessoria_id() TO authenticated;
GRANT EXECUTE ON FUNCTION sync_clientes_acessoria_id() TO service_role;

-- Executar uma vez para corrigir dados existentes
SELECT sync_clientes_acessoria_id() AS clientes_atualizados;
