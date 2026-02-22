-- CNPJ da empresa (para relatórios; ex.: Controle dividendos ATA 2025). razao_social já existe em empresas.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cnpj TEXT;
COMMENT ON COLUMN empresas.cnpj IS 'CNPJ da empresa (apenas números ou formatado).';
