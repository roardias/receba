-- clientes.codigo_nome_fantasia como chave secundária para acessorias.id
-- Relaciona clientes (codigo extraído do nome) com acessorias (id_planilha)

-- 1. Garantir que id_planilha seja único em acessorias (para FK)
CREATE UNIQUE INDEX IF NOT EXISTS acessorias_id_planilha_key
  ON acessorias(id_planilha);

-- 2. Adicionar coluna acessoria_id em clientes (FK para acessorias)
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS acessoria_id UUID REFERENCES acessorias(id);

-- 3. Trigger: ao inserir/atualizar cliente, preencher acessoria_id quando codigo_nome_fantasia bater com id_planilha
CREATE OR REPLACE FUNCTION clientes_sync_acessoria_id()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.codigo_nome_fantasia IS NOT NULL AND NEW.codigo_nome_fantasia != '' THEN
    SELECT id INTO NEW.acessoria_id
    FROM acessorias
    WHERE id_planilha = NEW.codigo_nome_fantasia
    LIMIT 1;
  ELSE
    NEW.acessoria_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clientes_sync_acessoria_id ON clientes;
CREATE TRIGGER trg_clientes_sync_acessoria_id
  BEFORE INSERT OR UPDATE OF nome_fantasia
  ON clientes
  FOR EACH ROW
  EXECUTE FUNCTION clientes_sync_acessoria_id();

-- 4. Preencher acessoria_id nos registros existentes
UPDATE clientes c
SET acessoria_id = a.id
FROM acessorias a
WHERE a.id_planilha = c.codigo_nome_fantasia
  AND c.codigo_nome_fantasia IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_acessoria_id ON clientes(acessoria_id) WHERE acessoria_id IS NOT NULL;

COMMENT ON COLUMN clientes.acessoria_id IS 'FK para acessorias(id). Relacionado via codigo_nome_fantasia = acessorias.id_planilha.';
