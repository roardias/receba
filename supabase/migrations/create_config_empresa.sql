-- Configurações da "Minha empresa" para uso nos relatórios
-- Uma única linha: logomarca (URL), cor de fundo atrás da logo, nome que aparece nos relatórios

CREATE TABLE IF NOT EXISTS config_empresa (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT,
  logo_url TEXT,
  background_color TEXT NOT NULL DEFAULT '#FFFFFF',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Garantir que exista apenas um registro (singleton)
INSERT INTO config_empresa (nome, background_color)
SELECT '', '#FFFFFF'
WHERE NOT EXISTS (SELECT 1 FROM config_empresa LIMIT 1);

COMMENT ON TABLE config_empresa IS 'Configuração da empresa para relatórios: nome, logomarca (URL) e cor de fundo atrás da logo.';
