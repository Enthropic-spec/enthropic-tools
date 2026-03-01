use crate::{parser, tui, validator};
use anyhow::Result;

const LANGUAGES: &[&str] = &["python", "rust", "typescript", "go", "other"];
const ARCH_STYLES: &[&str] = &[
    "layered",
    "event-driven",
    "realtime",
    "offline-first",
    "other",
];

pub fn run() -> Result<()> {
    tui::print_header();

    println!("  New Enthropic project\n");

    let project_name: String = tui::input("Project name")?;
    println!();

    let lang_idx = tui::select("Primary language", LANGUAGES)?;
    let lang = LANGUAGES[lang_idx];
    println!();

    let arch_idx = tui::select("Architecture style", ARCH_STYLES)?;
    let arch = ARCH_STYLES[arch_idx];
    println!();

    let stack_raw = tui::input("Stack (comma-separated, e.g. fastapi, postgresql)")?;
    let stack: Vec<String> = stack_raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    println!();

    println!("  Entities — the core domain objects of your project.");
    let entities_raw = tui::input("Add entities (comma-separated, snake_case)")?;
    let entities: Vec<String> = entities_raw
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    println!();

    // Layers
    struct LayerDef {
        name: String,
        calls: Vec<String>,
        never: Vec<String>,
    }
    let mut layers: Vec<LayerDef> = Vec::new();

    println!("  Layers — logical boundaries in your code.");
    let add_layers = tui::confirm("Add layers? (you can skip and add manually)")?;
    println!();

    if add_layers {
        loop {
            let layer_name = tui::input("Layer name (UPPER_CASE)")?;
            println!();

            let calls_raw = tui::input("This layer CALLS (comma-separated layer names)")?;
            let calls: Vec<String> = calls_raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            println!();

            let never_raw = tui::input_with_default(
                "This layer NEVER (comma-separated, optional — leave blank to skip)",
                "",
            )?;
            let never: Vec<String> = never_raw
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            println!();

            layers.push(LayerDef {
                name: layer_name,
                calls,
                never,
            });

            let add_more = tui::confirm("Add another layer?")?;
            println!();
            if !add_more {
                break;
            }
        }
    }

    // Secrets
    let mut secrets: Vec<String> = Vec::new();

    println!("  Secrets — environment variables this project needs.");
    let add_secrets = tui::confirm("Add secrets? (API keys, DB URLs, etc.)")?;
    println!();

    if add_secrets {
        let secrets_raw = tui::input("Secret names (comma-separated, UPPER_CASE)")?;
        secrets = secrets_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        println!();
    }

    // Build .enth content
    let slug = project_name.trim().to_lowercase().replace(' ', "_");
    let name_clean = project_name.trim().trim_matches('"');

    let mut content = String::new();
    content.push_str("VERSION 1\n\n");
    content.push_str(&format!("PROJECT \"{}\"\n", name_clean));
    content.push_str(&format!("  LANG {}\n", lang));
    content.push_str(&format!("  ARCH {}\n", arch));
    if !stack.is_empty() {
        content.push_str(&format!("  STACK {}\n", stack.join(", ")));
    }
    content.push('\n');

    if !entities.is_empty() {
        content.push_str(&format!("ENTITY {}\n\n", entities.join(", ")));
    }

    if !layers.is_empty() {
        content.push_str("LAYERS\n");
        for layer in &layers {
            content.push_str(&format!("  {}\n", layer.name));
            if !layer.calls.is_empty() {
                content.push_str(&format!("    CALLS {}\n", layer.calls.join(", ")));
            }
            for n in &layer.never {
                content.push_str(&format!("    NEVER {}\n", n));
            }
        }
        content.push('\n');
    }

    if !secrets.is_empty() {
        content.push_str("SECRETS\n");
        for s in &secrets {
            content.push_str(&format!("  {}\n", s));
        }
        content.push('\n');
    }

    // Write spec file
    let spec_filename = "enthropic.enth";
    let state_filename = format!("state_{}.enth", slug);
    let vault_filename = format!("vault_{}.enth", slug);

    std::fs::write(spec_filename, &content)?;

    // Validate
    let spec = parser::parse(std::path::Path::new(spec_filename))?;
    let errors = validator::validate(&spec);

    if !errors.is_empty() {
        println!();
        tui::print_error("Validation warnings (file written but has issues):");
        for e in &errors {
            println!("  [{:>2}] {} — {}", e.rule, e.severity, e.message);
        }
        println!();
    }

    // Create state file
    let state_content = crate::state::generate(&spec, &slug);
    std::fs::write(&state_filename, state_content)?;

    // Create vault file
    crate::vault::refresh_vault_file(&slug, &spec.secrets, std::path::Path::new("."))?;

    // Create/update .gitignore
    let gitignore = ".gitignore";
    let ignore_entries = ["vault_*.enth", "state_*.enth", ".env"];
    if !std::path::Path::new(gitignore).exists() {
        std::fs::write(gitignore, ignore_entries.join("\n") + "\n")?;
    } else {
        let existing = std::fs::read_to_string(gitignore)?;
        let additions: Vec<&str> = ignore_entries
            .iter()
            .filter(|&&e| !existing.contains(e))
            .copied()
            .collect();
        if !additions.is_empty() {
            let new_content = existing.trim_end().to_string() + "\n" + &additions.join("\n") + "\n";
            std::fs::write(gitignore, new_content)?;
        }
    }

    println!();
    if errors.is_empty() {
        tui::print_success(&format!("{} created and validated", spec_filename));
    } else {
        tui::print_success(&format!(
            "{} created (with warnings — check above)",
            spec_filename
        ));
    }
    tui::print_success(&format!("{} created", state_filename));
    tui::print_success(&format!("{} created", vault_filename));
    println!();
    tui::print_dim("  Next: run  enthropic build  to start building with AI.");

    Ok(())
}
