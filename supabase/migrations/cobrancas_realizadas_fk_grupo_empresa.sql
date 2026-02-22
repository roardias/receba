-- Relacionamentos: cobrancas_realizadas -> grupos e empresas (para filtros por visibilidade)
-- Mantém grupo_nome e empresas_internas_nomes para exibição; usa grupo_id/empresa_id para filtrar.

-- 1. Colunas de FK
ALTER TABLE cobrancas_realizadas
  ADD COLUMN IF NOT EXISTS grupo_id UUID REFERENCES grupos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE SET NULL;

COMMENT ON COLUMN cobrancas_realizadas.grupo_id IS 'FK para grupos; preenchido por correspondência com grupo_nome.';
COMMENT ON COLUMN cobrancas_realizadas.empresa_id IS 'FK para empresas; preenchido por correspondência com empresas_internas_nomes (primeira que der match).';

-- 2. Backfill grupo_id: match grupo_nome com grupos.nome (trim, case-insensitive)
UPDATE cobrancas_realizadas c
SET grupo_id = g.id
FROM grupos g
WHERE c.grupo_id IS NULL
  AND c.grupo_nome IS NOT NULL
  AND trim(lower(c.grupo_nome)) = trim(lower(g.nome));

-- 3. Backfill empresa_id: match exato ou empresas_internas_nomes contém nome_curto (primeira empresa que der match)
UPDATE cobrancas_realizadas c
SET empresa_id = (
  SELECT e.id
  FROM empresas e
  WHERE trim(c.empresas_internas_nomes) = e.nome_curto
     OR c.empresas_internas_nomes ILIKE e.nome_curto || ',%'
     OR c.empresas_internas_nomes ILIKE '%,' || e.nome_curto
     OR c.empresas_internas_nomes ILIKE '%,' || e.nome_curto || ',%'
     OR (trim(c.empresas_internas_nomes) <> '' AND c.empresas_internas_nomes ILIKE '%' || e.nome_curto || '%')
  ORDER BY
    CASE WHEN trim(c.empresas_internas_nomes) = e.nome_curto THEN 0 ELSE 1 END,
    length(e.nome_curto) DESC
  LIMIT 1
)
WHERE c.empresa_id IS NULL
  AND c.empresas_internas_nomes IS NOT NULL
  AND trim(c.empresas_internas_nomes) <> '';

-- 4. Índices para filtro
CREATE INDEX IF NOT EXISTS idx_cobrancas_realizadas_grupo_id ON cobrancas_realizadas(grupo_id);
CREATE INDEX IF NOT EXISTS idx_cobrancas_realizadas_empresa_id ON cobrancas_realizadas(empresa_id);
