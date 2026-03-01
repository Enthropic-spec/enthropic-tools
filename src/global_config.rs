use anyhow::{Context as _, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GlobalConfig {
    pub provider: Option<String>,
    pub model: Option<String>,
}

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn config_dir() -> PathBuf {
    home_dir().join(".enthropic")
}

fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

fn global_key_path() -> PathBuf {
    config_dir().join("global.key")
}

fn global_keys_path() -> PathBuf {
    config_dir().join("global.keys")
}

fn ensure_dir() -> Result<()> {
    std::fs::create_dir_all(config_dir())
        .with_context(|| "Failed to create ~/.enthropic directory")?;
    Ok(())
}

pub fn load_config() -> GlobalConfig {
    let p = config_path();
    if !p.exists() {
        return GlobalConfig::default();
    }
    std::fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_config(cfg: &GlobalConfig) -> Result<()> {
    ensure_dir()?;
    let json = serde_json::to_string_pretty(cfg)?;
    std::fs::write(config_path(), json)?;
    Ok(())
}

fn get_or_create_global_key() -> Result<[u8; 32]> {
    ensure_dir()?;
    let kp = global_key_path();
    if kp.exists() {
        let bytes = std::fs::read(&kp).with_context(|| "Failed to read global key file")?;
        if bytes.len() != 32 {
            anyhow::bail!(
                "Global key file corrupted: expected 32 bytes, got {}",
                bytes.len()
            );
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return Ok(key);
    }

    let mut key = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut key);
    std::fs::write(&kp, key)?;

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

fn load_api_keys() -> Result<HashMap<String, String>> {
    let p = global_keys_path();
    if !p.exists() {
        return Ok(HashMap::new());
    }
    let key = get_or_create_global_key()?;
    let cipherdata = std::fs::read(&p)?;
    let plaintext = decrypt_data(&key, &cipherdata)?;
    let keys: HashMap<String, String> = serde_json::from_slice(&plaintext)?;
    Ok(keys)
}

fn save_api_keys(keys: &HashMap<String, String>) -> Result<()> {
    ensure_dir()?;
    let key = get_or_create_global_key()?;
    let json = serde_json::to_vec(keys)?;
    let encrypted = encrypt_data(&key, &json)?;
    let p = global_keys_path();
    std::fs::write(&p, &encrypted)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
    }

    Ok(())
}

pub fn set_api_key(provider: &str, key: &str) -> Result<()> {
    let mut keys = load_api_keys().unwrap_or_default();
    keys.insert(provider.to_string(), key.to_string());
    save_api_keys(&keys)
}

pub fn get_api_key(provider: &str) -> Result<Option<String>> {
    let keys = load_api_keys()?;
    Ok(keys.get(provider).cloned())
}

pub fn has_any_key() -> bool {
    load_api_keys()
        .map(|keys| !keys.is_empty())
        .unwrap_or(false)
}
