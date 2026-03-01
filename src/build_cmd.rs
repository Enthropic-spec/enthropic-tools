use std::io::{self, Write};
use std::path::PathBuf;
use anyhow::Result;
use serde_json::{json, Value};
use indicatif::{ProgressBar, ProgressStyle};

use crate::{context, global_config, parser, tui};

struct Message {
    role: String,
    content: String,
}

const SYSTEM_SUFFIX: &str = "\n\nYou are helping build this project. The spec above is the source of truth.\nFollow all VOCABULARY, LAYERS, CONTRACTS, and FLOWS constraints exactly.\nWhen you write code, always specify the file path above each block.\nKeep responses focused. If asked to implement something, write the code directly.";

pub fn run(file: Option<&PathBuf>) -> Result<()> {
    tui::print_header();

    let cfg = global_config::load_config();
    let provider = match cfg.provider.as_deref() {
        Some(p) => p.to_string(),
        None => {
            tui::print_error("No provider configured. Run  enthropic setup  first.");
            return Ok(());
        }
    };
    let model = match cfg.model.as_deref() {
        Some(m) => m.to_string(),
        None => {
            tui::print_error("No model configured. Run  enthropic setup  first.");
            return Ok(());
        }
    };
    let api_key = match global_config::get_api_key(&provider)? {
        Some(k) => k,
        None => {
            tui::print_error(&format!(
                "No API key found for {}. Run  enthropic setup  first.",
                provider
            ));
            return Ok(());
        }
    };

    let spec_path = resolve_spec(file)?;
    let spec = parser::parse(&spec_path)?;

    let project_name = project_name_from_spec(&spec, &spec_path);
    let dir = spec_path.parent().unwrap_or(std::path::Path::new("."));
    let state_candidate = dir.join(format!("state_{}.enth", project_name));
    let state_path = if state_candidate.exists() { Some(state_candidate) } else { None };

    let context_text = context::generate(&spec, state_path.as_deref())?;
    let system_prompt = context_text + SYSTEM_SUFFIX;

    let entity_count = spec.entities.len();
    let flow_count = spec.flows.len();
    let layer_count = spec.layers.len();

    let dim = tui::dimmed();
    let sep = tui::pink().apply_to("──────────────────────────────────────────────────────────");
    println!(
        "  {} spec: {}  provider: {}  model: {} ",
        dim.apply_to(""),
        dim.apply_to(spec_path.display().to_string().as_str()),
        dim.apply_to(&provider),
        dim.apply_to(&model)
    );
    println!("{}", sep);
    println!(
        "  Context loaded. {} entities · {} flows · {} layers · all PENDING",
        entity_count, flow_count, layer_count
    );
    println!("{}\n", sep);

    let mut history: Vec<Message> = Vec::new();

    loop {
        print!("{} ", tui::bold_white().apply_to("You ›"));
        io::stdout().flush()?;

        let mut user_input = String::new();
        io::stdin().read_line(&mut user_input)?;
        let user_input = user_input.trim().to_string();

        if user_input.is_empty() || user_input == "quit" || user_input == "exit" {
            tui::print_dim("\n  Goodbye.");
            break;
        }

        history.push(Message {
            role: "user".to_string(),
            content: user_input.clone(),
        });

        let spinner = ProgressBar::new_spinner();
        spinner.set_style(
            ProgressStyle::with_template("{spinner:.magenta} {msg}")
                .unwrap()
                .tick_strings(&["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]),
        );
        spinner.set_message("thinking…");
        spinner.enable_steady_tick(std::time::Duration::from_millis(80));

        let response = call_api(&provider, &model, &api_key, &system_prompt, &history);

        spinner.finish_and_clear();

        match response {
            Ok(reply) => {
                let prefix = tui::pink().apply_to("🧠  ›");
                println!("{} {}\n", prefix, reply);
                history.push(Message {
                    role: "assistant".to_string(),
                    content: reply,
                });
            }
            Err(e) => {
                tui::print_error(&format!("API error: {}", e));
            }
        }
    }

    Ok(())
}

fn call_api(
    provider: &str,
    model: &str,
    api_key: &str,
    system_prompt: &str,
    history: &[Message],
) -> Result<String> {
    match provider {
        "anthropic" => call_anthropic(model, api_key, system_prompt, history),
        "openai" => call_openai_compatible(
            "https://api.openai.com/v1/chat/completions",
            model,
            api_key,
            system_prompt,
            history,
        ),
        "openrouter" => call_openai_compatible(
            "https://openrouter.ai/api/v1/chat/completions",
            model,
            api_key,
            system_prompt,
            history,
        ),
        _ => anyhow::bail!("Unknown provider: {}", provider),
    }
}

fn call_anthropic(
    model: &str,
    api_key: &str,
    system_prompt: &str,
    history: &[Message],
) -> Result<String> {
    let client = reqwest::blocking::Client::new();

    let messages: Vec<Value> = history
        .iter()
        .map(|m| json!({"role": m.role, "content": m.content}))
        .collect();

    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "system": system_prompt,
        "messages": messages,
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()?;

    let status = resp.status();
    let text = resp.text()?;

    if !status.is_success() {
        anyhow::bail!("Anthropic API error {}: {}", status, text);
    }

    let parsed: Value = serde_json::from_str(&text)?;
    let content = parsed["content"][0]["text"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Unexpected Anthropic response shape: {}", text))?
        .to_string();

    Ok(content)
}

fn call_openai_compatible(
    base_url: &str,
    model: &str,
    api_key: &str,
    system_prompt: &str,
    history: &[Message],
) -> Result<String> {
    let client = reqwest::blocking::Client::new();

    let mut messages: Vec<Value> = vec![json!({"role": "system", "content": system_prompt})];
    for m in history {
        messages.push(json!({"role": m.role, "content": m.content}));
    }

    let body = json!({
        "model": model,
        "max_tokens": 4096,
        "messages": messages,
    });

    let resp = client
        .post(base_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()?;

    let status = resp.status();
    let text = resp.text()?;

    if !status.is_success() {
        anyhow::bail!("API error {}: {}", status, text);
    }

    let parsed: Value = serde_json::from_str(&text)?;
    let content = parsed["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| anyhow::anyhow!("Unexpected API response shape: {}", text))?
        .to_string();

    Ok(content)
}

fn resolve_spec(path: Option<&PathBuf>) -> Result<PathBuf> {
    if let Some(p) = path {
        if p.exists() {
            return Ok(p.clone());
        }
    }
    let default = PathBuf::from("enthropic.enth");
    if default.exists() {
        return Ok(default);
    }
    anyhow::bail!("No .enth file specified and enthropic.enth not found in the current directory.")
}

fn project_name_from_spec(spec: &parser::EnthSpec, path: &std::path::Path) -> String {
    use crate::parser::ProjectValue;
    let raw = match spec.project.get("NAME") {
        Some(ProjectValue::Str(s)) => s.clone(),
        _ => path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("project")
            .to_string(),
    };
    raw.trim_matches('"').to_lowercase().replace(' ', "_")
}
