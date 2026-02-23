-- Recoloca coluna empresa_id em recebimentos_omie (FK para empresas).
-- O sync envia empresa_id no insert; chave_empresa_cliente continua gerada a partir de empresa + det_ncodcliente.

ALTER TABLE recebimentos_omie
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id);

CREATE INDEX IF NOT EXISTS idx_recebimentos_omie_empresa_id ON recebimentos_omie(empresa_id);

-- Chave única para upsert (sync usa on_conflict = empresa_id, det_ncodtitulo)
ALTER TABLE recebimentos_omie DROP CONSTRAINT IF EXISTS uq_recebimentos_omie_empresa_titulo;
ALTER TABLE recebimentos_omie
  ADD CONSTRAINT uq_recebimentos_omie_empresa_titulo UNIQUE (empresa_id, det_ncodtitulo);

COMMENT ON COLUMN recebimentos_omie.empresa_id IS 'FK para empresas(id). Preenchido pelo sync a partir do agendamento.';
