-- Adiciona empresa_id em dividendos_ata_2025 (tabela criada sem a coluna).
-- Todos os registros existentes são da empresa Iris.

ALTER TABLE dividendos_ata_2025
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;

UPDATE dividendos_ata_2025
SET empresa_id = '1012591f-e0c0-414a-b739-33224aa6290e'
WHERE empresa_id IS NULL;

ALTER TABLE dividendos_ata_2025
  ALTER COLUMN empresa_id SET NOT NULL;

-- Índices (único por empresa + cpf)
DROP INDEX IF EXISTS idx_dividendos_ata_2025_cpf;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dividendos_ata_2025_empresa_cpf
  ON dividendos_ata_2025(empresa_id, cpf);
CREATE INDEX IF NOT EXISTS idx_dividendos_ata_2025_empresa
  ON dividendos_ata_2025(empresa_id);

COMMENT ON COLUMN dividendos_ata_2025.empresa_id IS 'FK para empresas(id). Ata 2025 = empresa Iris.';
