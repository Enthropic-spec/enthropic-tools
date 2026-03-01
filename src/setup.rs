use anyhow::Result;
use crate::{global_config, tui};

const PROVIDERS: &[&str] = &["anthropic", "openai", "openrouter"];

const ANTHROPIC_MODELS: &[&str] = &["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-3-5"];
const OPENAI_MODELS: &[&str] = &["gpt-4o", "gpt-4-turbo", "gpt-4o-mini"];
const OPENROUTER_MODELS: &[&str] = &[
    "openai/gpt-4o",
    "anthropic/claude-opus-4-5",
    "anthropic/claude-sonnet-4-5",
    "meta-llama/llama-3.1-70b-instruct",
];

pub fn run() -> Result<()> {
    tui::print_header();

    println!("  Welcome to Enthropic.\n");
    println!("  To use  enthropic build  you need an API key from one of:");
    println!("  › Anthropic  (claude-opus-4-5, claude-sonnet-4-5)");
    println!("  › OpenAI     (gpt-4o, gpt-4-turbo)");
    println!("  › OpenRouter (access to all models)");
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

    let api_key = tui::password(&format!("API key for {}", provider))?;
    println!();

    let models: &[&str] = match provider {
        "anthropic" => ANTHROPIC_MODELS,
        "openai" => OPENAI_MODELS,
        _ => OPENROUTER_MODELS,
    };

    let model_idx = tui::select("Default model", models)?;
    let model = models[model_idx];
    println!();

    global_config::set_api_key(provider, &api_key)?;

    let new_cfg = global_config::GlobalConfig {
        provider: Some(provider.to_string()),
        model: Some(model.to_string()),
    };
    global_config::save_config(&new_cfg)?;

    println!();
    tui::print_success("Key stored encrypted in ~/.enthropic/global.keys");
    tui::print_success("Config saved to ~/.enthropic/config.json");
    println!();
    tui::print_dim("  Run  enthropic build  from any project folder to start.");

    Ok(())
}
