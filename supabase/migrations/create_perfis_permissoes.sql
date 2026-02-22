-- Permissões por perfil: menus e ações parametrizáveis por usuário
-- Chaves: menu_historico_cobrancas, historico_cobrancas_editar, dashboard_enviar_email, dashboard_registrar_ligacao, dashboard_registrar_whatsapp, menu_cadastro_usuarios, menu_email, enviar_email_teste, email_configurar, menu_acessorias, menu_agendamentos, menu_logs, config_grupos_empresas_editar, config_minha_empresa_imagem_cor

CREATE TABLE IF NOT EXISTS perfis_permissoes (
  perfil_id uuid NOT NULL REFERENCES perfis(id) ON DELETE CASCADE,
  permissao text NOT NULL,
  PRIMARY KEY (perfil_id, permissao)
);

CREATE INDEX IF NOT EXISTS idx_perfis_permissoes_perfil ON perfis_permissoes(perfil_id);

COMMENT ON TABLE perfis_permissoes IS 'Permissões por usuário: menus visíveis e ações (ex.: enviar e-mail de teste). Para role usuario, vazio = padrão (todos exceto cadastro usuário).';
