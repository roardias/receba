# Criptografia de credenciais Omie

O `app_secret` deve ser armazenado **criptografado** no banco.

## 1. Gerar a chave de criptografia

```bash
python gerar_chave_criptografia.py
```

Copie a saída e adicione ao `.env`:

```
ENCRYPTION_KEY=sua_chave_gerada
```

**Importante:** guarde essa chave com segurança. Sem ela, não será possível descriptografar os secrets já salvos.

## 2. Uso no código

```python
from utils.criptografia import criptografar, descriptografar

# Ao salvar no banco
app_secret_encrypted = criptografar("valor_do_app_secret")

# Ao ler do banco (para chamar a API Omie)
app_secret = descriptografar(app_secret_encrypted)
```

## 3. Fluxo

| Etapa | Ação |
|-------|------|
| Usuário cadastra empresa | Frontend envia app_secret |
| Backend salva | Criptografa e grava em `app_secret_encrypted` |
| Sync/API chama Omie | Lê do banco, descriptografa, usa na requisição |
| Frontend exibe | Nunca exibir o valor — mostrar "••••••" ou "configurado" |

## 4. Tabela empresas

- `app_key` — pode ficar em texto (menos sensível)
- `app_secret_encrypted` — sempre criptografado
