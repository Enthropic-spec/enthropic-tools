from __future__ import annotations

import json
from pathlib import Path

try:
    from cryptography.fernet import Fernet
    HAS_CRYPTO = True
except ImportError:
    HAS_CRYPTO = False

_KEY_DIR = Path.home() / ".enthropic"
_KEY_SUFFIX = ".key"
_SECRETS_SUFFIX = ".secrets"  # encrypted JSON blob, separate from the status file


def _key_path(project: str) -> Path:
    return _KEY_DIR / f"{project}{_KEY_SUFFIX}"


def _secrets_path(project: str) -> Path:
    return _KEY_DIR / f"{project}{_SECRETS_SUFFIX}"


def _require_crypto() -> None:
    if not HAS_CRYPTO:
        raise RuntimeError("cryptography package is required: pip install cryptography")


def _get_or_create_key(project: str) -> bytes:
    """Return the Fernet key for this project, creating it if it doesn't exist.

    Key lives in ~/.enthropic/<project>.key (chmod 600).
    Never committed. Never in chat. Equivalent security to ~/.ssh/id_rsa.
    """
    kp = _key_path(project)
    _KEY_DIR.mkdir(exist_ok=True)
    if kp.exists():
        return kp.read_bytes()
    key = Fernet.generate_key()
    kp.write_bytes(key)
    kp.chmod(0o600)
    return key


def _load_secrets(project: str) -> dict[str, str]:
    """Decrypt and return the secrets dict. Returns {} if no secrets set yet."""
    _require_crypto()
    sp = _secrets_path(project)
    if not sp.exists():
        return {}
    f = Fernet(_get_or_create_key(project))
    return json.loads(f.decrypt(sp.read_bytes()).decode())


def _save_secrets(project: str, secrets: dict[str, str]) -> None:
    """Encrypt and persist the secrets dict."""
    _require_crypto()
    _KEY_DIR.mkdir(exist_ok=True)
    sp = _secrets_path(project)
    f = Fernet(_get_or_create_key(project))
    sp.write_bytes(f.encrypt(json.dumps(secrets).encode()))
    sp.chmod(0o600)


# ── vault status file (gitignored, tracks SET/UNSET — never values) ───────────

def generate_vault_file(project: str, secret_names: list[str], directory: Path) -> str:
    """Generate vault status file content from declared SECRETS in spec.

    Contains only key names and SET/UNSET status. Never contains values.
    """
    existing = _load_secrets(project) if HAS_CRYPTO else {}
    lines = [f"VAULT {project}", ""]
    if secret_names:
        for name in secret_names:
            status = "SET" if name in existing else "UNSET"
            lines.append(f"  {name:<28} {status}")
    else:
        lines.append("  # no secrets declared in spec")
    lines.append("")
    return "\n".join(lines)


def refresh_vault_file(project: str, secret_names: list[str], directory: Path) -> None:
    """Rewrite vault status file reflecting current SET/UNSET state."""
    vault_path = directory / f"vault_{project}.enth"
    vault_path.write_text(
        generate_vault_file(project, secret_names, directory),
        encoding="utf-8"
    )


# ── public API ────────────────────────────────────────────────────────────────

def set_secret(project: str, key: str, value: str, directory: Path,
               secret_names: list[str]) -> None:
    secrets = _load_secrets(project)
    secrets[key] = value
    _save_secrets(project, secrets)
    refresh_vault_file(project, secret_names, directory)


def delete_secret(project: str, key: str, directory: Path,
                  secret_names: list[str]) -> None:
    secrets = _load_secrets(project)
    if key not in secrets:
        raise KeyError(f"Key '{key}' not found in vault")
    del secrets[key]
    _save_secrets(project, secrets)
    refresh_vault_file(project, secret_names, directory)


def list_keys(project: str, directory: Path) -> list[str]:
    """Return list of key names that have been SET. Never returns values."""
    return list(_load_secrets(project).keys())


def export_env(project: str, directory: Path) -> str:
    """Decrypt all secrets and return as .env format string.

    This is the only operation that produces plaintext values.
    Never called automatically. Always explicit user action.
    """
    secrets = _load_secrets(project)
    return "\n".join(f'{k}="{v}"' for k, v in secrets.items())
