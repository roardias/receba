# Subir o projeto para o GitHub

Repositório: **https://github.com/roardias/receba.git**

Abra o **terminal** (PowerShell ou CMD) na pasta do projeto e rode os comandos **na ordem**:

---

### 1. Entrar na pasta do projeto (se ainda não estiver)

```bash
cd "c:\Programas criados por Rodrigo\Receba"
```

---

### 2. Inicializar o Git (só na primeira vez)

```bash
git init
```

---

### 3. Adicionar o remote do GitHub

```bash
git remote add origin https://github.com/roardias/receba.git
```

*(Se aparecer que o remote "origin" já existe, use antes: `git remote remove origin` e depois o comando acima.)*

---

### 4. Adicionar todos os arquivos (respeitando o .gitignore)

```bash
git add .
```

---

### 5. Fazer o primeiro commit

```bash
git commit -m "Envio inicial do projeto Receba"
```

---

### 6. Garantir que a branch principal se chama main

```bash
git branch -M main
```

---

### 7. Enviar para o GitHub

```bash
git push -u origin main
```

Se o GitHub pedir **usuário e senha**, use:
- **Usuário:** seu usuário do GitHub (ex.: `roardias`)
- **Senha:** um **Personal Access Token** (não a senha da conta).  
  Criar token: GitHub → Settings → Developer settings → Personal access tokens → Generate new token (marque pelo menos `repo`).

---

## Depois disso

Sempre que quiser enviar novas alterações:

```bash
git add .
git commit -m "Descrição do que mudou"
git push
```

---

**Observação:** O `.gitignore` já está configurado para **não** subir:
- `.env`, `.env.local`, `frontend/.env.local` (suas chaves e segredos)
- `frontend/node_modules/` e `frontend/.next/`
- `__pycache__/`, `.venv/`, `venv/`

Assim, nada sensível vai para o repositório.
