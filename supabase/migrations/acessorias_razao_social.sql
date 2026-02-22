-- Adiciona coluna razao_social em acessorias (se a tabela já existir)
ALTER TABLE acessorias ADD COLUMN IF NOT EXISTS razao_social TEXT;
