# Como rodar o scheduler na VPS

**Recomendado:** Se você quer que a VPS funcione **igual à sua máquina** (quando `npm run dev` está rodando), use o guia **[RODAR_NA_VPS_IGUAL_MAQUINA.md](./RODAR_NA_VPS_IGUAL_MAQUINA.md)**. Nele você sobe o Next.js e o scheduler Python na VPS com as mesmas variáveis de ambiente — mesmo comportamento que no seu PC.

---

**Opção alternativa (cron + Vercel):** Abaixo, os passos para a VPS só rodar um **cron** que chama a API do Receba na Vercel nos horários configurados. O sync nesse caso é feito pela Edge Function do Supabase (fluxo diferente do Python da sua máquina).

**Importante:** O `vercel.json` do projeto pode ter um cron (ex.: uma vez por dia). No plano Hobby da Vercel, cron só pode rodar **uma vez por dia**. Para o scheduler disparar no minuto certo (ex.: 18:44), é preciso que **a VPS** chame a API **a cada minuto** (`* * * * *` no crontab). O cron da Vercel sozinho não atende horários como 18:44.

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

### 4.2. Adicionar uma linha (obrigatório: a cada 1 minuto)

A API só dispara o sync **no minuto exato** em que é chamada. Ex.: agendamento às 18:44 só roda se a API for chamada às 18:44. Por isso o cron deve rodar **a cada minuto**:

```cron
* * * * * curl -s -H "x-cron-secret: VALOR_DO_CRON_SECRET_KEY" "https://SEU_DOMINIO.vercel.app/api/scheduler/run" > /dev/null 2>&1
```

Substitua `VALOR_DO_CRON_SECRET_KEY` e `SEU_DOMINIO`.

- `* * * * *` = **a cada minuto** (necessário para bater no horário exato: 12:12, 18:44, etc.).
- Se usar `*/5` (a cada 5 min), horários como 18:44 são perdidos (a próxima chamada seria 18:45).
- `> /dev/null 2>&1` = descarta a saída (opcional; pode remover para ver erros no e-mail do cron, se estiver configurado).

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
| 4 | Agendar: `crontab -e` e adicionar a linha com `curl` (**`* * * * *`** = a cada minuto) |
| 5 | Verificar: `crontab -l` |

A API do Receba verifica **dentro dela** o dia da semana e o horário (America/Sao_Paulo) e só dispara a sincronização para os agendamentos que batem com o **minuto exato** da chamada. Por isso o cron na VPS deve rodar **a cada minuto** (`* * * * *`); se rodar a cada 5 ou 15 minutos, a maioria dos horários (ex.: 18:44, 12:12) nunca será atendida.
