"""
Criptografia para app_secret (credenciais Omie).
Usa Fernet (AES-128-CBC) com chave em variável de ambiente.
"""
import os
import base64
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def _get_fernet() -> Fernet:
    """Obtém instância Fernet a partir de ENCRYPTION_KEY."""
    key = os.getenv("ENCRYPTION_KEY")
    if not key:
        raise ValueError(
            "ENCRYPTION_KEY não definida no .env. "
            "Execute: python gerar_chave_criptografia.py"
        )
    key_str = key.strip() if isinstance(key, str) else key.decode()
    key_bytes = key_str.encode("utf-8")
    # Chave Fernet = 44 caracteres base64; senão deriva de senha
    if len(key_str) == 44:
        try:
            return Fernet(key_str.encode())
        except Exception:
            pass
    return Fernet(_derivar_chave(key_bytes))


def _derivar_chave(senha: bytes) -> bytes:
    """Deriva chave Fernet a partir de uma senha (PBKDF2)."""
    salt = b"receba_omie_v1"  # salt fixo para este projeto
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=480000,
    )
    return base64.urlsafe_b64encode(kdf.derive(senha))


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
