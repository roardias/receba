# Subir arquivos para a VPS (scheduler + syncs)

**No seu PC:** rode os comandos no **PowerShell** ou no **CMD** (na pasta raiz do projeto Receba).  
Suba os arquivos listados para a VPS na **mesma estrutura de pastas** (raiz do projeto na VPS = pasta onde está `scheduler_sync.py`).

---

## Passo 1: Validar o que já está na VPS

Antes de subir tudo, confira o que já existe na VPS.

1. Na raiz do projeto, abra **CMD** ou **PowerShell**.
2. Use os mesmos dados do servidor que já estão em [RODAR_SCHEDULER_NA_VPS.md](RODAR_SCHEDULER_NA_VPS.md) e [RODAR_NA_VPS_IGUAL_MAQUINA.md](RODAR_NA_VPS_IGUAL_MAQUINA.md): chave `id_ed25519_receba`, usuário **root**, destino **~/Receba**. Substitua apenas **IP_DO_SERVIDOR** pelo IP da sua VPS.

**No CMD:**

```cmd
set CHAVE=%USERPROFILE%\.ssh\id_ed25519_receba
set HOST_VPS=root@IP_DO_SERVIDOR
set DESTINO=~/Receba

scp -i %CHAVE% vps_validar_arquivos.py %HOST_VPS%:%DESTINO%/
ssh -i %CHAVE% %HOST_VPS% "cd %DESTINO% && python3 vps_validar_arquivos.py"
```

**No PowerShell:**

```powershell
$chave = "$env:USERPROFILE\.ssh\id_ed25519_receba"
$hostVps = "root@IP_DO_SERVIDOR"
$destino = "~/Receba"
scp -i $chave vps_validar_arquivos.py "${hostVps}:${destino}/"
ssh -i $chave $hostVps "cd $destino && python3 vps_validar_arquivos.py"
```

A saída mostra **OK** (arquivo existe) e **FALTA** (precisa subir). Para listar só o que falta: na VPS rode `python3 vps_validar_arquivos.py --falta`.

---

## Passo 2: Subir só o que falta

Depois de validar, envie apenas os arquivos que apareceram como FALTA (veja exemplos mais abaixo em PowerShell ou CMD/.bat).

---

## Obrigatório (scheduler e syncs)

| Caminho | Descrição |
|---------|-----------|
| `scheduler_sync.py` | Loop do agendamento; chama todos os syncs (clientes, categorias, movimento_financeiro, movimentos_geral, etc.) |
| `sync_clientes_supabase.py` | Sync clientes → Supabase |
| `sync_categorias_supabase.py` | Sync categorias |
| `sync_movimentos_supabase.py` | Sync movimento_financeiro → tabela movimentos |
| `sync_pagamentos_realizados_supabase.py` | Sync pagamentos realizados |
| `sync_recebimentos_supabase.py` | Sync recebimentos Omie |
| **`sync_titulos_pagos_a_vencer_supabase.py`** | **Sync Movimentos Geral → titulos_pagos + titulos_a_vencer** |
| **`api_omie_movimentos_geral.py`** | **API Omie ListarMovimentos (Geral) usada pelo sync acima** |
| `api_omie_clientes.py` | API clientes Omie |
| `api_omie_categorias.py` | API categorias Omie |
| `api_omie_movimentos.py` | API movimentos (Contas a Receber) |
| `api_omie_pagamentos_realizados.py` | API pagamentos realizados |
| `api_omie_recebimentos.py` ou equivalente | API recebimentos |
| `scheduler_status.py` | Status em execução (api_sync_execucao_atual) |
| `utils/` | Pasta inteira (ex.: `utils/criptografia.py` para app_secret_encrypted) |

---

## Opcional (rodar sync manual ou por CSV)

| Caminho | Descrição |
|---------|-----------|
| `api_omie_movimentos - Geral.py` | Rodar Movimentos Geral manual: `python "api_omie_movimentos - Geral.py"` (usa `exemplo_empresas.csv`) |
| `api_omie_clientes.py` | Contém `ler_empresas_csv` usado pelo script acima |

---

## Não precisa subir para a VPS

- `frontend/` – deploy no Vercel/outro host
- `docs/` – só documentação (incluindo código da Edge para colar no Supabase)
- `supabase/migrations/` – rodar no Supabase (SQL Editor ou `supabase db push`), não na VPS
- `.env` – **criar/editar direto na VPS** com `SUPABASE_URL`, `SUPABASE_KEY` (ou `SUPABASE_SERVICE_ROLE_KEY`) e, se usar secret criptografado, `ENCRYPTION_KEY`

---

## Na VPS depois de subir

1. Garantir que o `.env` na pasta do projeto tem as variáveis certas.
2. Instalar dependências (se ainda não):  
   `pip install supabase requests python-dotenv`
3. Rodar o scheduler (ex.: com PM2 ou no terminal):  
   `python -u scheduler_sync.py`  
   Ou, se usar o script do package: `npm run scheduler` (com o `package.json` na raiz do projeto).

---

## Resumo rápido (só o novo – Movimentos Geral)

Se a VPS já tem o resto e você só quer adicionar Movimentos Geral, suba estes 3:

1. `api_omie_movimentos_geral.py`
2. `sync_titulos_pagos_a_vencer_supabase.py`
3. `scheduler_sync.py` (versão atual que inclui o bloco `movimentos_geral`)

Depois reinicie o processo do scheduler na VPS.

---

## Exemplo: copiar no PowerShell (Windows)

Na raiz do projeto, abra o **PowerShell**. Use os mesmos dados do servidor (chave, root, ~/Receba); substitua **IP_DO_SERVIDOR** pelo IP da VPS:

```powershell
$chave = "$env:USERPROFILE\.ssh\id_ed25519_receba"
$hostVps = "root@IP_DO_SERVIDOR"
$destino = "~/Receba"

# Arquivos obrigatórios
$arquivos = @(
  "scheduler_sync.py",
  "scheduler_status.py",
  "sync_clientes_supabase.py",
  "sync_categorias_supabase.py",
  "sync_movimentos_supabase.py",
  "sync_pagamentos_realizados_supabase.py",
  "sync_recebimentos_supabase.py",
  "sync_titulos_pagos_a_vencer_supabase.py",
  "api_omie_movimentos_geral.py",
  "api_omie_clientes.py",
  "api_omie_categorias.py",
  "api_omie_movimentos.py",
  "api_omie_pagamentos_realizados.py",
  "api_omie_recebimentos.py",
  "api_omie_movimentos - Geral.py"
)

foreach ($f in $arquivos) {
  if (Test-Path $f) { scp -i $chave $f "${hostVps}:${destino}/" } else { Write-Host "Ignorado (não encontrado): $f" }
}
scp -i $chave -r utils "${hostVps}:${destino}/"
```

O `.env` **não** deve ser enviado por cima; configure-o direto na VPS.

**No CMD** (mesmos dados: chave, root@IP_DO_SERVIDOR, ~/Receba):

```cmd
set CHAVE=%USERPROFILE%\.ssh\id_ed25519_receba
set HOST_VPS=root@IP_DO_SERVIDOR
set DESTINO=~/Receba

scp -i %CHAVE% scheduler_sync.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% scheduler_status.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% sync_clientes_supabase.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% sync_categorias_supabase.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% sync_movimentos_supabase.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% sync_pagamentos_realizados_supabase.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% sync_recebimentos_supabase.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% sync_titulos_pagos_a_vencer_supabase.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% api_omie_movimentos_geral.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% api_omie_clientes.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% api_omie_categorias.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% api_omie_movimentos.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% api_omie_pagamentos_realizados.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% api_omie_recebimentos.py %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% "api_omie_movimentos - Geral.py" %HOST_VPS%:%DESTINO%/
scp -i %CHAVE% -r utils %HOST_VPS%:%DESTINO%/
```

---

## Exemplo: copiar só o necessário (Linux/macOS)

Na raiz do projeto (no seu PC), pode usar `rsync` para enviar só os arquivos Python e a pasta `utils`:

```bash
# Ajuste usuario e host para o seu servidor
RSYNC_TARGET="usuario@seu-servidor:/caminho/do/projeto/Receba/"

rsync -avz \
  scheduler_sync.py \
  scheduler_status.py \
  sync_clientes_supabase.py \
  sync_categorias_supabase.py \
  sync_movimentos_supabase.py \
  sync_pagamentos_realizados_supabase.py \
  sync_recebimentos_supabase.py \
  sync_titulos_pagos_a_vencer_supabase.py \
  api_omie_movimentos_geral.py \
  api_omie_clientes.py \
  api_omie_categorias.py \
  api_omie_movimentos.py \
  api_omie_pagamentos_realizados.py \
  api_omie_recebimentos.py \
  "api_omie_movimentos - Geral.py" \
  utils/ \
  "$RSYNC_TARGET"
```

O `.env` **não** deve ser sobrescrito pelo rsync; configure-o direto na VPS.
