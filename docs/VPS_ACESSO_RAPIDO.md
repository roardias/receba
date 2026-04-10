# VPS - Acesso Rapido (Receba)

Use este arquivo como referencia rapida para acessar e atualizar a VPS.

## Dados de acesso

- **IP VPS:** `191.252.218.123`
- **Hostname VPS:** `vps64848.publiccloud.com.br`
- **Usuario:** `root`
- **Chave SSH (Windows):** `%USERPROFILE%\.ssh\id_ed25519_receba`
- **Pasta do projeto na VPS:** `~/Receba`

## Conectar (PowerShell)

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_receba" root@191.252.218.123
```

Alternativa por hostname:

```powershell
ssh root@vps64848.publiccloud.com.br
```

## Atualizar codigo na VPS (Git)

```bash
cd ~/Receba
git pull
```

## Reiniciar scheduler

```bash
sudo systemctl restart receba-scheduler.service
sudo systemctl status receba-scheduler.service --no-pager
```

## Ver logs recentes

```bash
journalctl -u receba-scheduler.service -n 80 --no-pager
```
