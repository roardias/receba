-- Define grupo_id e empresa_id nos registros indicados (para filtro de visibilidade na página)

UPDATE cobrancas_realizadas
SET grupo_id   = '65e5a5b5-e57c-4401-bbbb-9fbf813e6f74',
    empresa_id = 'c08b538b-9a5a-4bb5-b6e4-19cb5942ea98'
WHERE id IN (
  '5c734912-afe8-41a2-b285-754f888ab731',
  '618063e3-5adf-4509-b882-7dcbbf258652'
);
