use std::collections::HashMap;
use std::path::{Path, PathBuf};
use anyhow::{Context as _, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::RngCore;

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn key_dir() -> PathBuf {
    home_dir().join(".enthropic")
}

fn key_path(project: &str) -> PathBuf {
    key_dir().join(format!("{}.key", project))
}

fn secrets_path(project: &str) -> PathBuf {
    key_dir().join(format!("{}.secrets", project))
}

fn get_or_create_key(project: &str) -> Result<[u8; 32]> {
    let kp = key_path(project);
    std::fs::create_dir_all(key_dir())?;

    if kp.exists() {
        let bytes = std::fs::read(&kp)
            .with_context(|| format!("Failed to read key file {}", kp.display()))?;
        if bytes.len() != 32 {
            anyhow::bail!("Key file corrupted: expected 32 bytes, got {}", bytes.len());
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    std::fs::write(&kp, &key)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&kp, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(key)
}

fn encrypt_data(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;
    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

fn decrypt_data(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < 12 {
        anyhow::bail!("Ciphertext too short");
    }
    let nonce = Nonce::from_slice(&data[..12]);
    let ciphertext = &data[12..];
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| anyhow::anyhow!("Decryption failed: {}", e))
}

fn load_secrets(project: &str) -> Result<HashMap<String, String>> {
    let sp = secrets_path(project);
    if !sp.exists() {
        return Ok(HashMap::new());
    }
    let key = get_or_create_key(project)?;
    let cipherdata = std::fs::read(&sp)?;
    let plaintext = decrypt_data(&key, &cipherdata)?;
    let secrets: HashMap<String, String> = serde_json::from_slice(&plaintext)?;
    Ok(secrets)
}

fn save_secrets(project: &str, secrets: &HashMap<String, String>) -> Result<()> {
    std::fs::create_dir_all(key_dir())?;
    let key = get_or_create_key(project)?;
    let json = serde_json::to_vec(secrets)?;
    let encrypted = encrypt_data(&key, &json)?;
    let sp = secrets_path(project);
    std::fs::write(&sp, &encrypted)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&sp, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

pub fn generate_vault_file(project: &str, secret_names: &[String]) -> Result<String> {
    let existing = load_secrets(project).unwrap_or_default();
    let mut lines: Vec<String> = vec![format!("VAULT {}", project), String::new()];

    if secret_names.is_empty() {
        lines.push("  # no secrets declared in spec".to_string());
    } else {
        for name in secret_names {
            let status = if existing.contains_key(name.as_str()) { "SET" } else { "UNSET" };
            lines.push(format!("  {:<28} {}", name, status));
        }
    }
    lines.push(String::new());
    Ok(lines.join("\n"))
}

pub fn refresh_vault_file(project: &str, secret_names: &[String], directory: &Path) -> Result<()> {
    let vault_path = directory.join(format!("vault_{}.enth", project));
    let content = generate_vault_file(project, secret_names)?;
    std::fs::write(&vault_path, content)?;
    Ok(())
}

pub fn set_secret(
    project: &str,
    key: &str,
    value: &str,
    directory: &Path,
    secret_names: &[String],
) -> Result<()> {
    let mut secrets = load_secrets(project)?;
    secrets.insert(key.to_string(), value.to_string());
    save_secrets(project, &secrets)?;
    refresh_vault_file(project, secret_names, directory)?;
    Ok(())
}

pub fn delete_secret(
    project: &str,
    key: &str,
    directory: &Path,
    secret_names: &[String],
) -> Result<()> {
    let mut secrets = load_secrets(project)?;
    if !secrets.contains_key(key) {
        anyhow::bail!("Key '{}' not found in vault", key);
    }
    secrets.remove(key);
    save_secrets(project, &secrets)?;
    refresh_vault_file(project, secret_names, directory)?;
    Ok(())
}

pub fn list_keys(project: &str) -> Result<Vec<String>> {
    let secrets = load_secrets(project)?;
    Ok(secrets.into_keys().collect())
}

pub fn export_env(project: &str) -> Result<String> {
    let secrets = load_secrets(project)?;
    let lines: Vec<String> = secrets
        .iter()
        .map(|(k, v)| format!("{}=\"{}\"", k, v))
        .collect();
    Ok(lines.join("\n"))
}
