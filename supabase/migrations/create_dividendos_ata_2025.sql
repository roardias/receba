-- Tabela dividendos_ata_2025: empresa (Iris), Nome, CPF (apenas números), valor_ata
-- FK para empresas (PK da empresa Iris).

CREATE TABLE IF NOT EXISTS dividendos_ata_2025 (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  cpf TEXT NOT NULL,
  valor_ata NUMERIC(20, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Um registro por (empresa, CPF)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dividendos_ata_2025_empresa_cpf ON dividendos_ata_2025(empresa_id, cpf);
CREATE INDEX IF NOT EXISTS idx_dividendos_ata_2025_empresa ON dividendos_ata_2025(empresa_id);
CREATE INDEX IF NOT EXISTS idx_dividendos_ata_2025_nome ON dividendos_ata_2025(nome);

COMMENT ON TABLE dividendos_ata_2025 IS 'Dividendos ata 2025: por empresa (ex.: Iris). nome, CPF (apenas dígitos), valor_ata.';
COMMENT ON COLUMN dividendos_ata_2025.empresa_id IS 'FK para empresas(id). Ata 2025 carregada é da empresa Iris.';
COMMENT ON COLUMN dividendos_ata_2025.cpf IS 'CPF somente números (sem ponto e traço).';
