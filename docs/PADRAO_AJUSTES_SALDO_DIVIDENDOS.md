# Padrao de ajustes de saldo - Controle de Dividendos ATA 2025

Este arquivo registra excecoes de regra para manter historico e facilitar novos ajustes.

## Regra geral

- Jan/2026: limite de competencia = 50.000,00.
- Fev/2026 em diante: limite de competencia = 48.000,00.

## Excecoes aprovadas

- Medico: Rafael Eidi Yamamoto
- Mes/ano: Abr/2026
- Regra aplicada:
  - saldo inicial em Abr/2026 deve ser zerado;
  - limite de competencia no mes fica 89.157,03 (em vez de 48.000,00).

## Onde a regra foi aplicada no codigo

- `supabase/migrations/view_controle_dividendos_ata_2025.sql`
- `supabase/migrations/view_controle_dividendos_ata_2025_limite_48k_fev2026.sql`
- `supabase/migrations/view_controle_dividendos_ata_2025_rafael_abr2026_zerar_saldo.sql`
