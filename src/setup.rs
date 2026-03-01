use crate::{global_config, tui};
use anyhow::Result;

const PROVIDERS: &[&str] = &["anthropic", "openai", "openrouter"];

fn fetch_anthropic_models(api_key: &str) -> Vec<String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send();
    match resp {
        Ok(r) if r.status().is_success() => {
            if let Ok(json) = r.json::<serde_json::Value>() {
                if let Some(data) = json["data"].as_array() {
                    let mut models: Vec<String> = data
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(std::string::ToString::to_string))
                        .collect();
                    models.sort();
                    models.reverse(); // newest first
                    return models;
                }
            }
            vec![]
        }
        _ => vec![],
    }
}

fn fetch_openai_models(api_key: &str) -> Vec<String> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {api_key}"))
        .send();
    match resp {
        Ok(r) if r.status().is_success() => {
            if let Ok(json) = r.json::<serde_json::Value>() {
                if let Some(data) = json["data"].as_array() {
                    let mut models: Vec<String> = data
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(std::string::ToString::to_string))
                        .filter(|id| {
                            id.starts_with("gpt-") || id.starts_with("o1") || id.starts_with("o3")
                        })
                        .collect();
                    models.sort();
                    models.reverse();
                    return models;
                }
            }
            vec![]
        }
        _ => vec![],
    }
}

fn fetch_openrouter_models() -> Vec<String> {
    // OpenRouter models endpoint is public — no key needed
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get("https://openrouter.ai/api/v1/models")
        .header(
            "HTTP-Referer",
            "https://github.com/Enthropic-spec/enthropic-tools",
        )
        .send();
    match resp {
        Ok(r) if r.status().is_success() => {
            if let Ok(json) = r.json::<serde_json::Value>() {
                if let Some(data) = json["data"].as_array() {
                    let mut models: Vec<String> = data
                        .iter()
                        .filter_map(|m| m["id"].as_str().map(std::string::ToString::to_string))
                        .collect();
                    models.sort();
                    return models;
                }
            }
            vec![]
        }
        _ => vec![],
    }
}

fn select_model(provider: &str, api_key: &str) -> Result<String> {
    tui::print_dim("  Fetching available models...");
    let models = match provider {
        "anthropic" => fetch_anthropic_models(api_key),
        "openai" => fetch_openai_models(api_key),
        "openrouter" => fetch_openrouter_models(),
        _ => vec![],
    };

    if models.is_empty() {
        tui::print_dim("  Could not fetch models. Enter model name manually.");
        return tui::input("Model name");
    }

    let items: Vec<&str> = models.iter().map(std::string::String::as_str).collect();
    let idx = tui::select("Default model", &items)?;
    Ok(models[idx].clone())
}

pub fn run() -> Result<()> {
    tui::print_header();

    println!("  Welcome to Enthropic.\n");
    println!("  To use  enthropic build  you need an API key.");
    println!("  Supported providers:  Anthropic · OpenAI · OpenRouter");
    println!();

    let cfg = global_config::load_config();
    let has_keys = global_config::has_any_key();

    if has_keys {
        let provider_str = cfg.provider.as_deref().unwrap_or("none");
        let model_str = cfg.model.as_deref().unwrap_or("none");
        println!(
            "  Current config: provider={}, model={}",
            tui::pink().apply_to(provider_str),
            tui::pink().apply_to(model_str)
        );
        println!();
        let update = tui::confirm("Update configuration?")?;
        if !update {
            tui::print_dim("  No changes made.");
            return Ok(());
        }
        println!();
    }

    let provider_idx = tui::select("Select provider", PROVIDERS)?;
    let provider = PROVIDERS[provider_idx];
    println!();

    let api_key = tui::password(&format!("API key for {provider}"))?;
    println!();

    let model = select_model(provider, &api_key)?;
    println!();

    global_config::set_api_key(provider, &api_key)?;

    let new_cfg = global_config::GlobalConfig {
        provider: Some(provider.to_string()),
        model: Some(model.clone()),
    };
    global_config::save_config(&new_cfg)?;

    println!();
    tui::print_success("Key stored encrypted in ~/.enthropic/global.keys");
    tui::print_success(&format!("Config saved  provider={provider}  model={model}"));
    println!();

    let create_now = tui::confirm("Create a new project now?")?;
    if create_now {
        println!();
        crate::new_wizard::run()?;
    } else {
        tui::print_dim("  Run  enthropic build  from any project folder to start.");
    }

    Ok(())
}
