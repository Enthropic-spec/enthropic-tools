use std::io::{self, Write};
use std::path::PathBuf;
use anyhow::Result;
use serde_json::{json, Value};
use indicatif::{ProgressBar, ProgressStyle};

use crate::{global_config, tui};

struct Message {
    role: String,
    content: String,
}

const SPEC_FORMAT: &str = r#"
## .enth Format Reference

File starts with: VERSION 0.1.0

### PROJECT (required)
  NAME   "project name"
  LANG   python|rust|typescript|go|...
  STACK  comma, separated, tech
  ARCH   layered|event-driven|realtime|hexagonal|...
  DEPS
    SYSTEM   os-level packages (e.g. tcl-tk, libpq)
    RUNTIME  production dependencies
    DEV      dev-only tools

### VOCABULARY (naming enforcement — prevents drift)
  PascalCaseName  # never: alternative_names
  AuthToken       # never: jwt, accessToken

### ENTITY (domain objects, snake_case)
  ENTITY user, product, order

### TRANSFORM (relationships between entities)
  TRANSFORM
    user -> cart : add_product, remove_product
    cart -> order : checkout

### SECRETS (key names only — no values)
  SECRETS
    DATABASE_URL
    STRIPE_KEY

### LAYERS (organizational boundaries)
  LAYERS
    API
      OWNS   http_routing, request_validation
      CALLS  CORE
      NEVER  direct_database_access
    CORE
      OWNS   business_logic, domain_rules
      CALLS  STORAGE
    STORAGE
      OWNS   persistence, queries

### CONTRACTS (behavioral invariants)
  CONTRACTS
    payment.*    ALWAYS  server-side
    admin.*      REQUIRES verified-admin-role
    FLOW checkout
      1. cart.validate
      2. payment.authorize
      3. order.confirm
      ROLLBACK  payment.void, order.cancel
      ATOMIC    true
      TIMEOUT   30s

## Rules
- VOCABULARY entries = PascalCase, LAYER names = UPPER_CASE, entities = snake_case
- All entities referenced in TRANSFORM/LAYERS/CONTRACTS must be declared in ENTITY
- FLOW steps are numbered and sequential
- SECRETS declares names only — never values
"#;

const SYSTEM_CONSULTANT: &str = r#"You are an Enthropic spec consultant. Your job is to help the user create a complete, precise .enth specification file for their project.

A .enth file is an architectural contract — not code, not pseudocode. It declares everything that must be true before any code is written. Once locked, it is the source of truth. Changes to it mean changes to the entire project.

Your role:
1. Ask questions to understand the project deeply before writing anything
2. Be proactive — if the user hasn't addressed auth, error handling, external APIs, deployment context, ask about them
3. Identify missing pieces: "You have a cart but no payment entity — intentional?"
4. When you have enough to write a complete spec, output it inside a ```enth code block
5. Explain your structural choices briefly after the block
6. Warn clearly: the spec is a contract. Changing it later means rethinking the entire architecture.

What to cover in consultation:
- Core domain entities and their relationships
- Technology stack, language, architecture style
- Canonical vocabulary (names that must never drift)
- Organizational layers and their boundaries
- Critical flows that must be atomic or have rollback
- Secrets and external dependencies
- What must NEVER happen (security invariants, responsibility violations)

When outputting the spec, use exactly the format in the reference below. Use real project names, meaningful vocabulary, proper layer boundaries. Not toy examples — thorough, production-grade.

Do not write code. Do not suggest implementation details. Only the spec.
"#;

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

    let system_prompt = SYSTEM_CONSULTANT.to_string() + SPEC_FORMAT;

    let sep = tui::pink().apply_to("──────────────────────────────────────────────────────────");
    let dim = tui::dimmed();

    // Check for existing spec
    let existing_spec = resolve_spec(file).ok();
    let mut history: Vec<Message> = Vec::new();

    if let Some(ref spec_path) = existing_spec {
        println!("  {} spec: {}  provider: {}  model: {}",
            dim.apply_to(""),
            dim.apply_to(spec_path.display().to_string().as_str()),
            dim.apply_to(&provider),
            dim.apply_to(&model)
        );
        println!("{}", sep);
        println!("  Existing spec found.");
        println!("{}\n", sep);

        let refine = tui::confirm("Refine existing spec with AI?")?;
        if refine {
            let spec_text = std::fs::read_to_string(spec_path)?;
            let opener = format!(
                "I'm loading your existing spec for review.\n\n```enth\n{}\n```\n\nTell me what you want to change or extend, or ask me to review it for completeness.",
                spec_text
            );
            let prefix = tui::pink().apply_to("🧠  ›");
            println!("{} {}\n", prefix, opener);
            history.push(Message { role: "assistant".to_string(), content: opener });
        } else {
            tui::print_dim("  Starting fresh consultation.");
            println!();
            print_opener();
        }
    } else {
        println!("  {} provider: {}  model: {}",
            dim.apply_to(""),
            dim.apply_to(&provider),
            dim.apply_to(&model)
        );
        println!("{}", sep);
        println!("  Spec consultant — design your .enth through conversation.");
        println!();
        println!("  {}  {}  {}",
            dim.apply_to("save → write spec to disk"),
            dim.apply_to("·"),
            dim.apply_to("exit → end session")
        );
        println!("{}\n", sep);
        print_opener();
    }

    let mut last_spec_block: Option<String> = None;
    let divider = tui::dimmed().apply_to("  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·");

    loop {
        print!("{} ", tui::bold_white().apply_to("You ›"));
        io::stdout().flush()?;

        let mut user_input = String::new();
        io::stdin().read_line(&mut user_input)?;
        let user_input = user_input.trim().to_string();

        if user_input.is_empty() { continue; }

        if user_input == "exit" || user_input == "quit" {
            println!();
            let confirm = tui::confirm("Exit session? Unsaved spec will be lost.")?;
            if confirm {
                tui::print_dim("  Session ended.");
                println!();
                break;
            }
            continue;
        }

        if user_input == "save" {
            if let Some(ref spec_content) = last_spec_block {
                save_spec(spec_content)?;
            } else {
                tui::print_dim("  No spec generated yet. Keep the conversation going.");
            }
            continue;
        }

        history.push(Message { role: "user".to_string(), content: user_input.clone() });

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
                println!("{}", divider);
                let prefix = tui::pink().apply_to("🧠  ›");
                println!("{} {}", prefix, reply);

                // detect ```enth block
                if let Some(spec) = extract_enth_block(&reply) {
                    last_spec_block = Some(spec);
                    println!();
                    tui::print_success("Spec ready. Type  save  to write it to disk.");
                }
                println!("{}\n", divider);

                history.push(Message { role: "assistant".to_string(), content: reply });
            }
            Err(e) => {
                tui::print_error(&format!("API error: {}  (session continues)", e));
                tui::print_dim("  Try again or switch model with  enthropic setup.");
                println!();
            }
        }
    }

    Ok(())
}

fn print_opener() {
    let prefix = tui::pink().apply_to("🧠  ›");
    println!("{} Tell me about the project you want to build.\n   What does it do, who uses it, what's the core problem it solves?\n", prefix);
}

fn extract_enth_block(text: &str) -> Option<String> {
    let start_marker = "```enth";
    let end_marker = "```";
    if let Some(start) = text.find(start_marker) {
        let after = &text[start + start_marker.len()..];
        // skip optional newline
        let after = after.trim_start_matches('\n');
        if let Some(end) = after.find(end_marker) {
            return Some(after[..end].trim().to_string());
        }
    }
    None
}

fn save_spec(content: &str) -> Result<()> {
    // validate first
    let tmp = std::env::temp_dir().join("_enthropic_tmp.enth");
    std::fs::write(&tmp, content)?;
    match crate::parser::parse(&tmp) {
        Ok(spec) => {
            let _ = std::fs::remove_file(&tmp);
            // determine file name from spec NAME or default
            use crate::parser::ProjectValue;
            let name = match spec.project.get("NAME") {
                Some(ProjectValue::Str(s)) => s.trim_matches('"').to_lowercase().replace(' ', "_"),
                _ => "enthropic".to_string(),
            };
            let out_path = PathBuf::from(format!("{}.enth", name));
            std::fs::write(&out_path, content)?;
            tui::print_success(&format!("Spec saved to {}", out_path.display()));

            // generate state + vault
            let state_content = crate::state::generate(&spec, &name);
            let state_path = PathBuf::from(format!("state_{}.enth", name));
            std::fs::write(&state_path, &state_content)?;
            tui::print_success(&format!("State file: {}", state_path.display()));

            if !spec.secrets.is_empty() {
                let dir = std::path::Path::new(".");
                crate::vault::refresh_vault_file(&name, &spec.secrets, dir)?;
                tui::print_success(&format!("Vault file: vault_{}.enth", name));
            }
            println!();
            tui::print_dim("  The spec is now your source of truth. Pass it to your AI coder as context.");
            println!();
        }
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            tui::print_error(&format!("Spec has validation errors: {}", e));
            tui::print_dim("  Keep refining with the consultant before saving.");
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
    anyhow::bail!("no spec")
}
