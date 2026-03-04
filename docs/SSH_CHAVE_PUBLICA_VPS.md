# Chave pública SSH para acesso ao servidor (VPS)

Este documento descreve como gerar um par de chaves SSH para conectar ao servidor VPS (ex.: Locaweb) de forma segura.

---

## Sugestão de tipo de chave

- **Recomendado: Ed25519** — moderna, curta, segura e rápida.
- **Alternativa: RSA 4096 bits** — compatível com sistemas mais antigos.

---

## 1. Gerar a chave (Windows — PowerShell ou CMD)

O Windows 10/11 já traz o OpenSSH. Abra **PowerShell** ou **Prompt de comando** e rode:

### Opção A — Ed25519 (recomendado)

```powershell
ssh-keygen -t ed25519 -C "receba-vps-locaweb" -f "$env:USERPROFILE\.ssh\id_ed25519_receba"
```

- `-C "receba-vps-locaweb"`: comentário para identificar a chave.
- `-f ...`: arquivo onde salvar. A pasta `%USERPROFILE%\.ssh` é o padrão do Windows.

Quando perguntar **passphrase**, você pode:
- Deixar em branco (Enter) para não usar senha na chave, ou
- Digitar uma senha para proteger a chave no seu PC.

Serão criados dois arquivos:
- `%USERPROFILE%\.ssh\id_ed25519_receba` — **chave privada** (nunca envie nem coloque em repositório).
- `%USERPROFILE%\.ssh\id_ed25519_receba.pub` — **chave pública** (esta você cadastra no painel da VPS).

### Opção B — RSA 4096 (se o painel não aceitar Ed25519)

```powershell
ssh-keygen -t rsa -b 4096 -C "receba-vps-locaweb" -f "$env:USERPROFILE\.ssh\id_rsa_receba"
```

Arquivos gerados:
- `%USERPROFILE%\.ssh\id_rsa_receba` — privada.
- `%USERPROFILE%\.ssh\id_rsa_receba.pub` — pública.

---

## 2. Copiar o conteúdo da chave pública

No PowerShell:

**Se usou Ed25519:**

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_receba.pub"
```

**Se usou RSA:**

```powershell
Get-Content "$env:USERPROFILE\.ssh\id_rsa_receba.pub"
```

Copie **toda a linha** que aparece (começa com `ssh-ed25519` ou `ssh-rsa`). É isso que você cola no painel da Locaweb (ou outro provedor) em “Chave pública” / “SSH key”.

---

## 3. Cadastrar no painel da VPS

1. No painel da Locaweb (ou do provedor), vá na etapa **Forma de acesso ao servidor**.
2. Escolha **Chave pública**.
3. Cole o conteúdo do arquivo `.pub` no campo indicado.
4. Salve e conclua a criação do servidor.

O provedor vai associar essa chave ao usuário de acesso (ex.: `root` ou um usuário que você definir).

---

## 4. Conectar ao servidor via SSH

Quando o VPS estiver ativo, você receberá um **IP** (e opcionalmente um usuário). No PowerShell:

**Se usou Ed25519:**

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_receba" usuario@IP_DO_SERVIDOR
```

**Se usou RSA:**

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_rsa_receba" usuario@IP_DO_SERVIDOR
```

Substitua `usuario` pelo usuário informado pelo provedor (ex.: `root`) e `IP_DO_SERVIDOR` pelo IP da VPS.

---

## 5. Resumo de segurança

| Item | Ação |
|------|------|
| Chave privada | Nunca compartilhe; não coloque em repositório nem envie por e-mail. |
| Chave pública | Só esta é cadastrada no servidor e pode ser compartilhada com o provedor. |
| Passphrase | Opcional; se definir, será pedida ao usar a chave (mais uma camada de segurança). |
| Backup | Guarde cópia segura da chave privada (e da passphrase, se usar); sem ela, o acesso por essa chave se perde. |

---

## Referência rápida (Linux / macOS)

```bash
# Ed25519
ssh-keygen -t ed25519 -C "receba-vps-locaweb" -f ~/.ssh/id_ed25519_receba

# Ver chave pública
cat ~/.ssh/id_ed25519_receba.pub

# Conectar
ssh -i ~/.ssh/id_ed25519_receba usuario@IP_DO_SERVIDOR
```
