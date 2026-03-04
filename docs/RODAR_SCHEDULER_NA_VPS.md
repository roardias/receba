# Como rodar o scheduler na VPS

Depois que o servidor (VPS) estiver criado e você tiver o **IP** e acesso por **SSH**, siga estes passos para o scheduler chamar a API do Receba na Vercel nos horários configurados.

---

## 1. Conectar na VPS

No **PowerShell** (Windows), usando a chave que você cadastrou:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_receba" root@IP_DO_SERVIDOR
```

(Substitua `root` pelo usuário que o provedor informou, se for outro, e `IP_DO_SERVIDOR` pelo IP da VPS.)

---

## 2. URL e segredo da API

A rota do scheduler na Vercel é:

- **URL:** `https://SEU_DOMINIO.vercel.app/api/scheduler/run`
- **Autenticação:** o mesmo valor da variável `CRON_SECRET_KEY` configurada no projeto na Vercel.

Você pode enviar o segredo de duas formas:

- Na query: `?secret=VALOR_DO_CRON_SECRET_KEY`
- No header: `x-cron-secret: VALOR_DO_CRON_SECRET_KEY`

Anote o **domínio exato** do app na Vercel (ex.: `receba-xxx.vercel.app`) e o **valor** de `CRON_SECRET_KEY` (em Settings → Environment Variables no painel da Vercel).

---

## 3. Rodar uma vez (teste)

Dentro da VPS, depois de conectado por SSH:

```bash
curl -s "https://SEU_DOMINIO.vercel.app/api/scheduler/run?secret=VALOR_DO_CRON_SECRET_KEY"
```

Ou usando o header (evita o segredo na URL):

```bash
curl -s -H "x-cron-secret: VALOR_DO_CRON_SECRET_KEY" "https://SEU_DOMINIO.vercel.app/api/scheduler/run"
```

Substitua `SEU_DOMINIO` e `VALOR_DO_CRON_SECRET_KEY`. Se der certo, a resposta vem em JSON (ex.: `{"ok":true,...}`).

---

## 4. Rodar automaticamente (cron)

Para o scheduler ser chamado sozinho em intervalos (ex.: a cada 5 minutos), use o **cron**.

### 4.1. Abrir o crontab

```bash
crontab -e
```

Se pedir editor, escolha `nano` (geralmente opção 1).

### 4.2. Adicionar uma linha

Exemplo: rodar **a cada 5 minutos**:

```cron
*/5 * * * * curl -s -H "x-cron-secret: VALOR_DO_CRON_SECRET_KEY" "https://SEU_DOMINIO.vercel.app/api/scheduler/run" > /dev/null 2>&1
```

Substitua `VALOR_DO_CRON_SECRET_KEY` e `SEU_DOMINIO`.

- `*/5 * * * *` = a cada 5 minutos.
- `> /dev/null 2>&1` = descarta a saída (opcional; pode remover para ver erros no e-mail do cron, se estiver configurado).

Outros exemplos:

- A cada 15 minutos: `*/15 * * * * ...`
- Uma vez por dia às 17:40 (horário do servidor): `40 17 * * * ...`  
  (Ajuste o fuso do servidor: se a VPS estiver em UTC, 17:40 UTC = 14:40 em Brasília.)

### 4.3. Salvar e sair

No `nano`: **Ctrl+O** (salvar), **Enter**, **Ctrl+X** (sair).

### 4.4. Conferir se o cron está ativo

```bash
crontab -l
```

Deve aparecer a linha que você adicionou.

---

## 5. Resumo

| Passo | O quê |
|-------|--------|
| 1 | Conectar na VPS: `ssh -i ...\id_ed25519_receba root@IP` |
| 2 | Anotar URL da Vercel e valor de `CRON_SECRET_KEY` |
| 3 | Testar: `curl -s -H "x-cron-secret: SEU_SECRET" "https://SEU_DOMINIO.vercel.app/api/scheduler/run"` |
| 4 | Agendar: `crontab -e` e adicionar a linha com `curl` (ex.: `*/5 * * * *`) |
| 5 | Verificar: `crontab -l` |

A API do Receba verifica **dentro dela** o dia da semana e o horário (America/Sao_Paulo) e só dispara a sincronização para os agendamentos que batem com o momento da chamada. Por isso, chamar a cada 5 ou 15 minutos na VPS é suficiente; não é preciso configurar um horário exato no cron, a menos que você queira apenas uma execução por dia em um horário fixo.
