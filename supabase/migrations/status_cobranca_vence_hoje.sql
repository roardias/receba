-- Novo status automático: "Vence hoje"
-- Insere o tipo na tabela de catálogo sem quebrar a ordem existente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM status_cobranca
    WHERE codigo = 'vence_hoje'
  ) THEN
    UPDATE status_cobranca
    SET ordem = ordem + 1
    WHERE ordem >= 2;

    INSERT INTO status_cobranca (codigo, label, ordem)
    VALUES ('vence_hoje', 'Vence hoje', 2);
  END IF;
END;
$$;
