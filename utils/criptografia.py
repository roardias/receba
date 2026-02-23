"""
Criptografia para app_secret (credenciais Omie).
Usa Fernet (AES-128-CBC) com chave em variável de ambiente.

A derivação da chave deve ser igual à do frontend (fernet-server.ts):
SHA256(ENCRYPTION_KEY) em base64url, para que dados criptografados no frontend
sejam descriptografados corretamente pelo scheduler/backend.
"""
import base64
import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken


def _normalizar_chave(key: str) -> str:
    """Normaliza ENCRYPTION_KEY como no frontend (BOM, aspas, espaços)."""
    if not key:
        return ""
    key = (key.strip() if isinstance(key, str) else key.decode()).strip()
    key = key.replace("\ufeff", "")  # BOM
    key = key.strip()
    # Remove aspas ao redor (como no frontend)
    if len(key) >= 2 and key[0] in '"\'' and key[-1] == key[0]:
        key = key[1:-1].strip()
    return key


def _derivar_chave_sha256(senha: str) -> bytes:
    """Deriva chave Fernet com SHA256 (igual ao frontend: deriveFernetKey)."""
    digest = hashlib.sha256(senha.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    """Obtém instância Fernet a partir de ENCRYPTION_KEY (mesma lógica do frontend)."""
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise ValueError(
            "ENCRYPTION_KEY não definida no .env. "
            "Execute: python gerar_chave_criptografia.py"
        )
    key_str = _normalizar_chave(key)
    if not key_str:
        raise ValueError("ENCRYPTION_KEY está vazia após normalização.")
    # Frontend sempre usa SHA256(key) -> base64url; backend usa o mesmo para compatibilidade
    key_bytes = _derivar_chave_sha256(key_str)
    return Fernet(key_bytes)


def criptografar(valor: str) -> str:
    """Criptografa string. Retorna base64 para armazenar como TEXT."""
    if not valor or not valor.strip():
        return ""
    f = _get_fernet()
    return f.encrypt(valor.strip().encode()).decode()


def descriptografar(valor_criptografado: str) -> str:
    """Descriptografa string. Retorna vazio se inválido ou vazio."""
    if not valor_criptografado or not valor_criptografado.strip():
        return ""
    try:
        f = _get_fernet()
        return f.decrypt(valor_criptografado.encode()).decode()
    except (InvalidToken, Exception):
        return ""


def gerar_chave() -> str:
    """Gera nova chave Fernet para ENCRYPTION_KEY."""
    return Fernet.generate_key().decode()
