-- Coluna opcional app_secret (texto) para o scheduler usar as credenciais Omie direto do Supabase.
-- Se app_secret estiver preenchido, o scheduler usa; senão usa descriptografar(app_secret_encrypted) com ENCRYPTION_KEY.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS app_secret TEXT;
COMMENT ON COLUMN empresas.app_secret IS 'App Secret Omie em texto (opcional). Se preenchido, o scheduler usa direto; senão usa app_secret_encrypted + ENCRYPTION_KEY.';
