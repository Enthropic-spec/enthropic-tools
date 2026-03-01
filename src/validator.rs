use crate::parser::EnthSpec;

pub struct ValidationError {
    pub rule: usize,
    pub message: String,
    pub severity: String,
}

fn is_upper_case(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

fn is_pascal_case(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric())
}

fn is_snake_case(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

pub fn validate(spec: &EnthSpec) -> Vec<ValidationError> {
    let mut errors: Vec<ValidationError> = Vec::new();
    let entities: std::collections::HashSet<&str> =
        spec.entities.iter().map(|s| s.as_str()).collect();

    // 1 — VERSION must be present
    if spec.version.is_empty() {
        errors.push(ValidationError {
            rule: 1,
            message: "VERSION is missing".to_string(),
            severity: "ERROR".to_string(),
        });
    }

    // 2 — ENTITY must declare at least one entity
    if entities.is_empty() {
        errors.push(ValidationError {
            rule: 2,
            message: "ENTITY must declare at least one entity".to_string(),
            severity: "ERROR".to_string(),
        });
    }

    // 3 — TRANSFORM entities must be declared
    for t in &spec.transforms {
        for name in [&t.source, &t.target] {
            if !entities.contains(name.as_str()) {
                errors.push(ValidationError {
                    rule: 3,
                    message: format!("TRANSFORM references undeclared entity '{}'", name),
                    severity: "ERROR".to_string(),
                });
            }
        }
    }

    // 4 — CONTRACT subjects must reference declared entities (or wildcard)
    for c in &spec.contracts {
        let base = c.subject.split('.').next().unwrap_or("");
        if base != "*" && !entities.contains(base) {
            errors.push(ValidationError {
                rule: 4,
                message: format!(
                    "CONTRACTS subject '{}' references undeclared entity '{}'",
                    c.subject, base
                ),
                severity: "ERROR".to_string(),
            });
        }
    }

    // 5 — FLOW step entities must be declared
    for flow in spec.flows.values() {
        for step in &flow.steps {
            if !step.subject.is_empty() && !entities.contains(step.subject.as_str()) {
                errors.push(ValidationError {
                    rule: 5,
                    message: format!(
                        "FLOW '{}' step {} references undeclared entity '{}'",
                        flow.name, step.number, step.subject
                    ),
                    severity: "ERROR".to_string(),
                });
            }
        }
    }

    // 6 — FLOW steps must be sequential from 1
    for flow in spec.flows.values() {
        let nums: Vec<usize> = flow.steps.iter().map(|s| s.number).collect();
        let expected: Vec<usize> = (1..=nums.len()).collect();
        if nums != expected {
            errors.push(ValidationError {
                rule: 6,
                message: format!(
                    "FLOW '{}' steps are not sequential from 1: {:?}",
                    flow.name, nums
                ),
                severity: "ERROR".to_string(),
            });
        }
    }

    // 7 — FLOW must have at least 2 steps
    for flow in spec.flows.values() {
        if flow.steps.len() < 2 {
            errors.push(ValidationError {
                rule: 7,
                message: format!(
                    "FLOW '{}' must have at least 2 steps (has {})",
                    flow.name,
                    flow.steps.len()
                ),
                severity: "ERROR".to_string(),
            });
        }
    }

    // 8 — LAYERS names must be UPPER_CASE
    for name in spec.layers.keys() {
        if !is_upper_case(name) {
            errors.push(ValidationError {
                rule: 8,
                message: format!("LAYERS name must be UPPER_CASE: '{}'", name),
                severity: "ERROR".to_string(),
            });
        }
    }

    // 9 — VOCABULARY entries must be PascalCase
    for entry in &spec.vocabulary {
        if !is_pascal_case(entry) {
            errors.push(ValidationError {
                rule: 9,
                message: format!("VOCABULARY entry must be PascalCase: '{}'", entry),
                severity: "ERROR".to_string(),
            });
        }
    }

    // 10 — ENTITY identifiers must be snake_case
    for entity in &spec.entities {
        if !is_snake_case(entity) {
            errors.push(ValidationError {
                rule: 10,
                message: format!("ENTITY identifier must be snake_case: '{}'", entity),
                severity: "ERROR".to_string(),
            });
        }
    }

    // 11 — VAULT blocks must not appear in enthropic.enth
    let source = spec.source_file.to_string_lossy();
    if source.ends_with("enthropic.enth") {
        if let Ok(raw) = std::fs::read_to_string(&spec.source_file) {
            for (lineno, line) in raw.lines().enumerate() {
                if line.trim().starts_with("VAULT ") {
                    errors.push(ValidationError {
                        rule: 11,
                        message: format!(
                            "VAULT block in enthropic.enth at line {} — secrets must live in vault_*.enth",
                            lineno + 1
                        ),
                        severity: "ERROR".to_string(),
                    });
                }
            }
        }
    }

    // 12 — LAYERS CALLS may only reference declared layer names
    let declared_layers: std::collections::HashSet<&str> =
        spec.layers.keys().map(|s| s.as_str()).collect();
    for layer in spec.layers.values() {
        for ref_name in &layer.calls {
            if !declared_layers.contains(ref_name.as_str()) {
                errors.push(ValidationError {
                    rule: 12,
                    message: format!(
                        "LAYERS '{}' CALLS undeclared layer '{}'",
                        layer.name, ref_name
                    ),
                    severity: "ERROR".to_string(),
                });
            }
        }
    }

    // 13 — SECRETS entries must be UPPER_CASE
    for secret in &spec.secrets {
        if !is_upper_case(secret) {
            errors.push(ValidationError {
                rule: 13,
                message: format!("SECRETS entry must be UPPER_CASE: '{}'", secret),
                severity: "ERROR".to_string(),
            });
        }
    }

    errors
}
