use std::path::Path;
use anyhow::Result;
use crate::parser::{EnthSpec, ProjectValue};

pub const STATUS_VALUES: &[&str] = &[
    "BUILT", "PARTIAL", "PENDING", "OK", "MISSING", "UNVERIFIED", "SET", "UNSET",
];

pub fn generate(spec: &EnthSpec, project_name: &str) -> String {
    let mut lines: Vec<String> = vec![format!("STATE {}", project_name), String::new()];

    // CHECKS — derived from LANG + DEPS.SYSTEM + DEPS.RUNTIME
    let mut checks: Vec<(String, String)> = Vec::new();
    if let Some(ProjectValue::Str(lang)) = spec.project.get("LANG") {
        checks.push((lang.clone(), "LANG".to_string()));
    }
    if let Some(ProjectValue::Deps(deps)) = spec.project.get("DEPS") {
        for dep in deps.get("SYSTEM").unwrap_or(&vec![]) {
            checks.push((dep.clone(), "DEPS.SYSTEM".to_string()));
        }
        for dep in deps.get("RUNTIME").unwrap_or(&vec![]) {
            checks.push((dep.clone(), "DEPS.RUNTIME".to_string()));
        }
    }

    if !checks.is_empty() {
        lines.push("  CHECKS".to_string());
        for (name, source) in &checks {
            lines.push(format!("    {:<28} UNVERIFIED   # {}", name, source));
        }
        lines.push(String::new());
    }

    if !spec.entities.is_empty() {
        lines.push("  ENTITY".to_string());
        for entity in &spec.entities {
            lines.push(format!("    {:<28} PENDING", entity));
        }
        lines.push(String::new());
    }

    if !spec.flows.is_empty() {
        lines.push("  FLOWS".to_string());
        for name in &spec.flows_order {
            lines.push(format!("    {:<28} PENDING", name));
        }
        lines.push(String::new());
    }

    if !spec.layers.is_empty() {
        lines.push("  LAYERS".to_string());
        for name in &spec.layers_order {
            lines.push(format!("    {:<28} PENDING", name));
        }
        lines.push(String::new());
    }

    lines.join("\n")
}

pub fn set_status(path: &Path, key: &str, status: &str) -> Result<()> {
    let status = status.to_uppercase();
    if !STATUS_VALUES.contains(&status.as_str()) {
        anyhow::bail!(
            "Invalid status '{}'. Must be: {}",
            status,
            STATUS_VALUES.join(", ")
        );
    }

    let content = std::fs::read_to_string(path)?;
    let mut result: Vec<String> = Vec::new();
    let mut updated = false;

    for line in content.lines() {
        let tok = line.trim();
        let parts: Vec<&str> = tok.split_whitespace().collect();
        if parts.len() == 2 && parts[0] == key && STATUS_VALUES.contains(&parts[1]) {
            let leading_len = line.len() - line.trim_start().len();
            let leading = &line[..leading_len];
            result.push(format!("{}{:<28} {}", leading, key, status));
            updated = true;
        } else {
            result.push(line.to_string());
        }
    }

    if !updated {
        anyhow::bail!("Key '{}' not found in state file", key);
    }

    std::fs::write(path, result.join("\n") + "\n")?;
    Ok(())
}
