from __future__ import annotations

import json
from pathlib import Path

try:
    from cryptography.fernet import Fernet
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

_KEY_DIR = Path.home() / ".enthropic"


def _key_path(project: str) -> Path:
    return _KEY_DIR / f"{project}.key"


def _require_crypto() -> None:
    if not HAS_CRYPTO:
        raise RuntimeError("cryptography package is required: pip install cryptography")


def _get_or_create_key(project: str) -> bytes:
    kp = _key_path(project)
    _KEY_DIR.mkdir(exist_ok=True)
    if kp.exists():
        return kp.read_bytes()
    key = Fernet.generate_key()
    kp.write_bytes(key)
    kp.chmod(0o600)
    return key


def _vault_path(project: str, directory: Path) -> Path:
    return directory / f"vault_{project}.enth"


def _load(project: str, directory: Path) -> dict[str, str]:
    f = Fernet(_get_or_create_key(project))
    vp = _vault_path(project, directory)
    if not vp.exists():
        return {}
    return json.loads(f.decrypt(vp.read_bytes()))


def _save(project: str, directory: Path, secrets: dict[str, str]) -> None:
    f = Fernet(_get_or_create_key(project))
    vp = _vault_path(project, directory)
    vp.write_bytes(f.encrypt(json.dumps(secrets).encode()))


def set_secret(project: str, key: str, value: str, directory: Path) -> None:
    _require_crypto()
    secrets = _load(project, directory)
    secrets[key] = value
    _save(project, directory, secrets)


def delete_secret(project: str, key: str, directory: Path) -> None:
    _require_crypto()
    secrets = _load(project, directory)
    if key not in secrets:
        raise KeyError(f"Key '{key}' not found in vault")
    del secrets[key]
    _save(project, directory, secrets)


def list_keys(project: str, directory: Path) -> list[str]:
    _require_crypto()
    return list(_load(project, directory).keys())


def export_env(project: str, directory: Path) -> str:
    _require_crypto()
    secrets = _load(project, directory)
    return "\n".join(f'{k}="{v}"' for k, v in secrets.items())
