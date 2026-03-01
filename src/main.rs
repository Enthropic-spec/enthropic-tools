mod build_cmd;
mod context;
mod global_config;
mod mcp;
mod new_wizard;
mod parser;
mod setup;
mod state;
mod tui;
mod validator;
mod vault;

use anyhow::Result;
use clap::{Parser, Subcommand};
use colored::Colorize;
use std::path::{Path, PathBuf};

use parser::{EnthSpec, ProjectValue};

#[derive(Parser)]
#[command(
    name = "enthropic",
    about = "Enthropic — toolkit for the .enth architectural specification format.",
    disable_help_subcommand = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    #[command(about = "Validate an .enth file against the Enthropic specification rules")]
    Validate {
        #[arg(help = ".enth file to validate")]
        file: Option<PathBuf>,
    },
    #[command(about = "Generate the context block to paste as AI system prompt")]
    Context {
        #[arg(help = ".enth spec file")]
        file: Option<PathBuf>,
        #[arg(long, short, help = "Write output to file")]
        out: Option<PathBuf>,
    },
    #[command(about = "Manage project build state")]
    State {
        #[command(subcommand)]
        command: StateCommands,
    },
    #[command(about = "Manage project secrets (encrypted vault)")]
    Vault {
        #[command(subcommand)]
        command: VaultCommands,
    },
    #[command(about = "Configure your AI provider and API key")]
    Setup,
    #[command(about = "Create a new Enthropic project interactively")]
    New,
    #[command(about = "Start an interactive AI build session for this project")]
    Build {
        #[arg(help = ".enth spec file (defaults to enthropic.enth)")]
        file: Option<PathBuf>,
    },
    #[command(about = "Start MCP server (stdio) — use with Claude Desktop, Cursor, or Docker")]
    Serve,
}

#[derive(Subcommand)]
enum StateCommands {
    #[command(about = "Show the current build state")]
    Show {
        #[arg(help = "State file or spec file")]
        file: Option<PathBuf>,
    },
    #[command(about = "Update a single entry's status in the state file")]
    Set {
        #[arg(help = "Key to update")]
        key: String,
        #[arg(help = "New status: BUILT | PARTIAL | PENDING")]
        status: String,
        #[arg(help = ".enth spec file")]
        file: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum VaultCommands {
    #[command(about = "Store a secret in the encrypted vault")]
    Set {
        #[arg(help = "Secret key name")]
        key: String,
        #[arg(help = "Secret value")]
        value: String,
        #[arg(help = ".enth spec file")]
        file: Option<PathBuf>,
    },
    #[command(about = "Remove a secret from the vault")]
    Delete {
        #[arg(help = "Secret key to remove")]
        key: String,
        #[arg(help = ".enth spec file")]
        file: Option<PathBuf>,
    },
    #[command(about = "List all key names in the vault")]
    Keys {
        #[arg(help = ".enth spec file")]
        file: Option<PathBuf>,
    },
    #[command(about = "Export vault contents as .env (decrypted)")]
    Export {
        #[arg(long, short, help = "Write to .env file")]
        out: Option<PathBuf>,
        #[arg(help = ".enth spec file")]
        file: Option<PathBuf>,
    },
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

fn project_name(spec: &EnthSpec, path: &Path) -> String {
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

fn vault_project(file: Option<&PathBuf>) -> Result<(String, PathBuf, Vec<String>)> {
    let spec_path = resolve_spec(file)?;
    let spec = parser::parse(&spec_path)?;
    let name = project_name(&spec, &spec_path);
    let dir = spec_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();
    Ok((name, dir, spec.secrets))
}

fn main() {
    if let Err(e) = run() {
        eprintln!("{} {}", "✗".red(), e);
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();

    cli.command.map_or_else(
        || {
            tui::print_header();
            print_help();
            Ok(())
        },
        |cmd| match cmd {
            Commands::Validate { file } => {
                tui::print_header();
                cmd_validate(file.as_ref())
            }
            Commands::Context { file, out } => {
                tui::print_header();
                cmd_context(file.as_ref(), out.as_ref())
            }
            Commands::State { command } => match command {
                StateCommands::Show { file } => {
                    tui::print_header();
                    cmd_state_show(file.as_ref())
                }
                StateCommands::Set { key, status, file } => {
                    tui::print_header();
                    cmd_state_set(&key, &status, file.as_ref())
                }
            },
            Commands::Vault { command } => match command {
                VaultCommands::Set { key, value, file } => {
                    tui::print_header();
                    cmd_vault_set(&key, &value, file.as_ref())
                }
                VaultCommands::Delete { key, file } => {
                    tui::print_header();
                    cmd_vault_delete(&key, file.as_ref())
                }
                VaultCommands::Keys { file } => {
                    tui::print_header();
                    cmd_vault_keys(file.as_ref())
                }
                VaultCommands::Export { out, file } => {
                    tui::print_header();
                    cmd_vault_export(out.as_ref(), file.as_ref())
                }
            },
            Commands::Setup => setup::run(),
            Commands::New => new_wizard::run(),
            Commands::Build { file } => build_cmd::run(file.as_ref()),
            Commands::Serve => mcp::serve(),
        },
    )
}

fn print_help() {
    let pk = tui::pink();
    let dim = tui::dimmed();
    let bold = tui::bold_white();
    println!("  {}", bold.apply_to("Commands"));
    println!();
    println!(
        "    {}    {}",
        pk.apply_to("setup     "),
        dim.apply_to("Configure AI provider and API key")
    );
    println!(
        "    {}    {}",
        pk.apply_to("new       "),
        dim.apply_to("Quick wizard to scaffold a new .enth file")
    );
    println!(
        "    {}    {}",
        pk.apply_to("build     "),
        dim.apply_to("AI spec consultant — design your .enth through conversation")
    );
    println!(
        "    {}    {}",
        pk.apply_to("validate  "),
        dim.apply_to("Validate an .enth file against the spec rules")
    );
    println!(
        "    {}    {}",
        pk.apply_to("context   "),
        dim.apply_to("Generate AI context block from a spec")
    );
    println!(
        "    {}    {}",
        pk.apply_to("state     "),
        dim.apply_to("Manage project build state (show / set)")
    );
    println!(
        "    {}    {}",
        pk.apply_to("vault     "),
        dim.apply_to("Manage encrypted project secrets (set / keys / export)")
    );
    println!(
        "    {}    {}",
        pk.apply_to("serve     "),
        dim.apply_to("MCP server (stdio) — integrates with Claude Desktop, Cursor, Docker")
    );
    println!();
    println!("  {}", bold.apply_to("Quick start"));
    println!();
    println!(
        "    {}  →  {}  →  {}",
        pk.apply_to("enthropic setup"),
        pk.apply_to("enthropic build"),
        dim.apply_to("get your .enth")
    );
    println!();
}

fn cmd_validate(file: Option<&PathBuf>) -> Result<()> {
    let path = resolve_spec(file)?;
    let spec = parser::parse(&path)?;
    let errors = validator::validate(&spec);

    if !errors.is_empty() {
        // Print error table
        let rule_w = 6;
        let sev_w = 9;
        println!(
            "{:<rule_w$} {:<sev_w$} Message",
            "Rule",
            "Severity",
            rule_w = rule_w,
            sev_w = sev_w
        );
        println!("{}", "-".repeat(80));
        for e in &errors {
            let sev = if e.severity == "ERROR" {
                e.severity.red().to_string()
            } else {
                e.severity.yellow().to_string()
            };
            println!(
                "{:<rule_w$} {:<sev_w$} {}",
                e.rule,
                sev,
                e.message,
                rule_w = rule_w,
                sev_w = sev_w + 10
            );
        }
        std::process::exit(1);
    }

    println!("{} {} — valid", "✓".green(), path.display());

    let name = project_name(&spec, &path);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));

    // Auto-create state file if missing
    let state_path = dir.join(format!("state_{name}.enth"));
    if !state_path.exists() {
        let content = state::generate(&spec, &name);
        std::fs::write(&state_path, content)?;
        println!(
            "{}",
            format!(
                "  created {}",
                state_path.file_name().unwrap_or_default().to_string_lossy()
            )
            .dimmed()
        );
    }

    // Always regenerate vault status file
    let vault_path = dir.join(format!("vault_{name}.enth"));
    let vault_existed = vault_path.exists();
    vault::refresh_vault_file(&name, &spec.secrets, dir)?;
    let vault_action = if vault_existed { "updated" } else { "created" };
    println!(
        "{}",
        format!(
            "  {} {}",
            vault_action,
            vault_path.file_name().unwrap_or_default().to_string_lossy()
        )
        .dimmed()
    );

    // Auto-create/update .gitignore
    let gitignore_path = dir.join(".gitignore");
    if gitignore_path.exists() {
        let existing = std::fs::read_to_string(&gitignore_path)?;
        let additions: Vec<&str> = ["vault_*.enth", "state_*.enth"]
            .iter()
            .filter(|&&e| !existing.contains(e))
            .copied()
            .collect();
        if !additions.is_empty() {
            let new_content = existing.trim_end().to_string() + "\n" + &additions.join("\n") + "\n";
            std::fs::write(&gitignore_path, new_content)?;
            println!("{}", "  updated .gitignore".dimmed());
        }
    } else {
        std::fs::write(&gitignore_path, "vault_*.enth\nstate_*.enth\n.env\n")?;
        println!("{}", "  created .gitignore".dimmed());
    }

    Ok(())
}

fn cmd_context(file: Option<&PathBuf>, out: Option<&PathBuf>) -> Result<()> {
    let path = resolve_spec(file)?;
    let spec = parser::parse(&path)?;

    let name = project_name(&spec, &path);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let candidate = dir.join(format!("state_{name}.enth"));
    let state_path = if candidate.exists() {
        Some(candidate)
    } else {
        None
    };

    let result = context::generate(&spec, state_path.as_deref())?;

    if let Some(out_path) = out {
        std::fs::write(out_path, &result)?;
        println!("{} Context written to {}", "✓".green(), out_path.display());
    } else {
        print!("{result}");
    }

    Ok(())
}

fn cmd_state_show(file: Option<&PathBuf>) -> Result<()> {
    let state_path = if let Some(f) = file {
        let is_state_file = f
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.starts_with("state_"));
        if is_state_file {
            f.clone()
        } else {
            let path = resolve_spec(Some(f))?;
            let spec = parser::parse(&path)?;
            let name = project_name(&spec, &path);
            path.parent()
                .unwrap_or_else(|| Path::new("."))
                .join(format!("state_{name}.enth"))
        }
    } else {
        let path = resolve_spec(None)?;
        let spec = parser::parse(&path)?;
        let name = project_name(&spec, &path);
        path.parent()
            .unwrap_or_else(|| Path::new("."))
            .join(format!("state_{name}.enth"))
    };

    if !state_path.exists() {
        eprintln!(
            "{} No state file found. Run 'enthropic validate' first.",
            "✗".red()
        );
        std::process::exit(1);
    }

    print!("{}", std::fs::read_to_string(&state_path)?);
    Ok(())
}

fn cmd_state_set(key: &str, status: &str, file: Option<&PathBuf>) -> Result<()> {
    let spec_path = resolve_spec(file)?;
    let spec = parser::parse(&spec_path)?;
    let name = project_name(&spec, &spec_path);
    let state_path = spec_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("state_{name}.enth"));

    if !state_path.exists() {
        eprintln!(
            "{} State file not found: {}. Run 'enthropic validate' first.",
            "✗".red(),
            state_path.display()
        );
        std::process::exit(1);
    }

    match state::set_status(&state_path, key, status) {
        Ok(()) => println!("{} {} → {}", "✓".green(), key, status.to_uppercase()),
        Err(e) => {
            eprintln!("{} {}", "✗".red(), e);
            std::process::exit(1);
        }
    }

    Ok(())
}

fn cmd_vault_set(key: &str, value: &str, file: Option<&PathBuf>) -> Result<()> {
    let (project, directory, secret_names) = vault_project(file)?;
    match vault::set_secret(&project, key, value, &directory, &secret_names) {
        Ok(()) => println!("{} {} → SET in vault_{}.enth", "✓".green(), key, project),
        Err(e) => {
            eprintln!("{} {}", "✗".red(), e);
            std::process::exit(1);
        }
    }
    Ok(())
}

fn cmd_vault_delete(key: &str, file: Option<&PathBuf>) -> Result<()> {
    let (project, directory, secret_names) = vault_project(file)?;
    match vault::delete_secret(&project, key, &directory, &secret_names) {
        Ok(()) => println!("{} {} → UNSET", "✓".green(), key),
        Err(e) => {
            eprintln!("{} {}", "✗".red(), e);
            std::process::exit(1);
        }
    }
    Ok(())
}

fn cmd_vault_keys(file: Option<&PathBuf>) -> Result<()> {
    let (project, _directory, _) = vault_project(file)?;
    match vault::list_keys(&project) {
        Ok(keys) => {
            if keys.is_empty() {
                println!("{}", "No secrets set yet.".dimmed());
            } else {
                for k in &keys {
                    println!("  {}  {}", k.cyan(), "SET".green());
                }
            }
        }
        Err(e) => {
            eprintln!("{} {}", "✗".red(), e);
            std::process::exit(1);
        }
    }
    Ok(())
}

fn cmd_vault_export(out: Option<&PathBuf>, file: Option<&PathBuf>) -> Result<()> {
    let (project, _directory, _) = vault_project(file)?;
    match vault::export_env(&project) {
        Ok(result) => {
            if let Some(out_path) = out {
                std::fs::write(out_path, &result)?;
                println!("{} Exported to {}", "✓".green(), out_path.display());
            } else {
                println!("{result}");
            }
        }
        Err(e) => {
            eprintln!("{} {}", "✗".red(), e);
            std::process::exit(1);
        }
    }
    Ok(())
}
