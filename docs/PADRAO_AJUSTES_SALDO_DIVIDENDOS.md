# Padrao de ajustes de saldo - Controle de Dividendos ATA 2025

Este arquivo registra excecoes de regra para manter historico e facilitar novos ajustes.

## Regra geral

- Jan/2026: limite de competencia = 50.000,00.
- Fev/2026 em diante: limite de competencia = 48.000,00.
- Ate Mar/2026: baixa primeiro pela Competencia (ate o limite); apenas o excedente vai para Baixa Ata 2025.
- Abr/2026 em diante (implementado em 07/05/2026): com saldo ATA disponivel e total do mes DENTRO do limite,
  a baixa passa a ser primeiro pela Ata (ate zerar o saldo); a competencia recebe apenas o restante.

## Excecoes aprovadas

- Medico: Rafael Eidi Yamamoto
- Mes/ano: Abr/2026
- Regra aplicada:
  - saldo inicial em Abr/2026 deve ser zerado;
  - limite de competencia no mes fica 89.157,03 (em vez de 48.000,00).

- Medico: Bruno Ricardo de Castro Prieto
- CPF: 248.547.798-10
- Mes/ano: Abr/2026
- Regra aplicada:
  - Baixa Ata 2025 no mes deve ser 152.910,64;
  - competencia e saldo final passam a ser recalculados com base nessa baixa.

- Medicos: Ronaldo Rodrigues da Cunha e Guilherme Benevenuto
- Mes/ano: Abr/2026 em diante (permanente)
- Regra aplicada:
  - mantem a REGRA ANTIGA (anterior a abr/2026): baixa primeiro pela Competencia (ate o limite do mes)
    e apenas o excedente vai para Baixa Ata 2025;
  - ou seja, eles ficam FORA da regra geral de abr/2026+ de baixar primeiro pela Ata.

## Onde a regra foi aplicada no codigo

- `supabase/migrations/view_controle_dividendos_ata_2025.sql`
- `supabase/migrations/view_controle_dividendos_ata_2025_limite_48k_fev2026.sql`
- `supabase/migrations/view_controle_dividendos_ata_2025_rafael_abr2026_zerar_saldo.sql`
- `supabase/migrations/clientes_normalizar_refresh_pagamentos_view.sql`
- `supabase/migrations/view_controle_dividendos_ata_2025_ronaldo_regra_antiga.sql` (versao mais recente da view)
