use crate::{parser, tui, validator};
use anyhow::Result;
use std::fmt::Write;

const LANGUAGES: &[&str] = &["python", "rust", "typescript", "go", "other"];
const ARCH_STYLES: &[&str] = &[
    "layered",
    "event-driven",
    "realtime",
    "offline-first",
    "other",
];

struct LayerDef {
    name: String,
    calls: Vec<String>,
    never: Vec<String>,
}

#[allow(clippy::too_many_lines)]
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
    writeln!(content, "PROJECT \"{name_clean}\"").unwrap();
    writeln!(content, "  LANG {lang}").unwrap();
    writeln!(content, "  ARCH {arch}").unwrap();
    if !stack.is_empty() {
        writeln!(content, "  STACK {}", stack.join(", ")).unwrap();
    }
    content.push('\n');

    if !entities.is_empty() {
        write!(content, "ENTITY {}\n\n", entities.join(", ")).unwrap();
    }

    if !layers.is_empty() {
        content.push_str("LAYERS\n");
        for layer in &layers {
            writeln!(content, "  {}", layer.name).unwrap();
            if !layer.calls.is_empty() {
                writeln!(content, "    CALLS {}", layer.calls.join(", ")).unwrap();
            }
            for n in &layer.never {
                writeln!(content, "    NEVER {n}").unwrap();
            }
        }
        content.push('\n');
    }

    if !secrets.is_empty() {
        content.push_str("SECRETS\n");
        for s in &secrets {
            writeln!(content, "  {s}").unwrap();
        }
        content.push('\n');
    }

    // Write spec file
    let spec_filename = "enthropic.enth";
    let state_filename = format!("state_{slug}.enth");
    let vault_filename = format!("vault_{slug}.enth");

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
    if std::path::Path::new(gitignore).exists() {
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
    } else {
        std::fs::write(gitignore, ignore_entries.join("\n") + "\n")?;
    }

    println!();
    if errors.is_empty() {
        tui::print_success(&format!("{spec_filename} created and validated"));
    } else {
        tui::print_success(&format!(
            "{spec_filename} created (with warnings — check above)"
        ));
    }
    tui::print_success(&format!("{state_filename} created"));
    tui::print_success(&format!("{vault_filename} created"));
    println!();
    tui::print_dim("  Next: run  enthropic build  to start building with AI.");

    Ok(())
}
