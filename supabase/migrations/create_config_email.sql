-- Configuração de e-mail Microsoft (Graph API) para envio automático
-- Permite múltiplas configurações; cada uma pode ser vinculada a várias empresas

CREATE TABLE IF NOT EXISTS config_email (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT,
  sender_mailbox TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS config_email_empresas (
  config_email_id UUID NOT NULL REFERENCES config_email(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  PRIMARY KEY (config_email_id, empresa_id)
);

CREATE INDEX idx_config_email_empresas_config ON config_email_empresas(config_email_id);
CREATE INDEX idx_config_email_empresas_empresa ON config_email_empresas(empresa_id);

COMMENT ON TABLE config_email IS 'Configurações de envio de e-mail via Microsoft (tenant, client, remetente).';
COMMENT ON TABLE config_email_empresas IS 'Quais empresas utilizam cada configuração de e-mail.';
