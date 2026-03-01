use anyhow::Result;
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

use crate::{context, parser, validator};

pub fn serve() -> Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();

    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }

        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // notifications have no id — no response needed
        let is_notification = msg.get("id").is_none();
        if is_notification {
            continue;
        }

        let id = msg["id"].clone();
        let method = msg["method"].as_str().unwrap_or("");
        let params = &msg["params"];

        let response = match method {
            "initialize" => handle_initialize(&id),
            "tools/list" => handle_tools_list(&id),
            "tools/call" => handle_tools_call(&id, params),
            "ping" => json!({"jsonrpc":"2.0","id":id,"result":{}}),
            _ => error_response(&id, -32601, "Method not found"),
        };

        writeln!(out, "{response}")?;
        out.flush()?;
    }

    Ok(())
}

fn handle_initialize(id: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "enthropic",
                "version": env!("CARGO_PKG_VERSION")
            }
        }
    })
}

fn handle_tools_list(id: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "tools": [
                {
                    "name": "read_spec",
                    "description": "Read the Enthropic .enth spec file for this project. Always call this before writing any code.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path to .enth file. Defaults to enthropic.enth in working directory."
                            }
                        }
                    }
                },
                {
                    "name": "get_context",
                    "description": "Get the full Enthropic context block — spec + state — formatted as AI system prompt. Use this as context before generating code.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path to .enth file. Defaults to enthropic.enth in working directory."
                            }
                        }
                    }
                },
                {
                    "name": "validate_spec",
                    "description": "Validate an Enthropic .enth spec file and return any errors or warnings.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path to .enth file to validate."
                            }
                        }
                    }
                },
                {
                    "name": "spec_summary",
                    "description": "Get a concise summary of the project: name, language, stack, entities, layers, open contracts.",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path to .enth file. Defaults to enthropic.enth in working directory."
                            }
                        }
                    }
                }
            ]
        }
    })
}

fn handle_tools_call(id: &Value, params: &Value) -> Value {
    let name = params["name"].as_str().unwrap_or("");
    let args = &params["arguments"];

    match name {
        "read_spec" => tool_read_spec(id, args),
        "get_context" => tool_get_context(id, args),
        "validate_spec" => tool_validate_spec(id, args),
        "spec_summary" => tool_spec_summary(id, args),
        _ => error_response(id, -32602, &format!("Unknown tool: {name}")),
    }
}

fn resolve_path(args: &Value) -> PathBuf {
    args["path"]
        .as_str()
        .map_or_else(|| PathBuf::from("enthropic.enth"), PathBuf::from)
}

fn tool_read_spec(id: &Value, args: &Value) -> Value {
    let path = resolve_path(args);
    match std::fs::read_to_string(&path) {
        Ok(content) => tool_ok(id, &content),
        Err(e) => tool_error(id, &format!("Cannot read {}: {}", path.display(), e)),
    }
}

fn tool_get_context(id: &Value, args: &Value) -> Value {
    let path = resolve_path(args);
    let spec = match parser::parse(&path) {
        Ok(s) => s,
        Err(e) => return tool_error(id, &format!("Parse error: {e}")),
    };

    // look for state file alongside spec
    let state_path = {
        use crate::parser::ProjectValue;
        let name = match spec.project.get("NAME") {
            Some(ProjectValue::Str(s)) => s.trim_matches('"').to_lowercase().replace(' ', "_"),
            _ => path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("project")
                .to_string(),
        };
        let dir = path.parent().unwrap_or_else(|| std::path::Path::new("."));
        let candidate = dir.join(format!("state_{name}.enth"));
        if candidate.exists() {
            Some(candidate)
        } else {
            None
        }
    };

    match context::generate(&spec, state_path.as_deref()) {
        Ok(ctx) => tool_ok(id, &ctx),
        Err(e) => tool_error(id, &format!("Context error: {e}")),
    }
}

fn tool_validate_spec(id: &Value, args: &Value) -> Value {
    let path = resolve_path(args);
    let spec = match parser::parse(&path) {
        Ok(s) => s,
        Err(e) => return tool_ok(id, &format!("PARSE ERROR: {e}")),
    };
    let errors = validator::validate(&spec);
    if errors.is_empty() {
        tool_ok(id, &format!("✓ {} is valid.", path.display()))
    } else {
        let lines: Vec<String> = errors
            .iter()
            .map(|e| format!("[{}] {} — {}", e.severity, e.rule, e.message))
            .collect();
        tool_ok(id, &format!("VALIDATION ERRORS:\n{}", lines.join("\n")))
    }
}

fn tool_spec_summary(id: &Value, args: &Value) -> Value {
    use crate::parser::ProjectValue;
    let path = resolve_path(args);
    let spec = match parser::parse(&path) {
        Ok(s) => s,
        Err(e) => return tool_error(id, &format!("Parse error: {e}")),
    };

    let name = spec
        .project
        .get("NAME")
        .and_then(|v| {
            if let ProjectValue::Str(s) = v {
                Some(s.trim_matches('"').to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unnamed".to_string());
    let lang = spec
        .project
        .get("LANG")
        .and_then(|v| {
            if let ProjectValue::List(l) = v {
                Some(l.join(", "))
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unspecified".to_string());
    let stack = spec
        .project
        .get("STACK")
        .and_then(|v| {
            if let ProjectValue::List(l) = v {
                Some(l.join(", "))
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unspecified".to_string());
    let arch = spec
        .project
        .get("ARCH")
        .and_then(|v| {
            if let ProjectValue::List(l) = v {
                Some(l.join(", "))
            } else {
                None
            }
        })
        .unwrap_or_else(|| "unspecified".to_string());

    let summary = format!(
        "Project: {}\nLanguage: {}\nStack: {}\nArchitecture: {}\nEntities: {} ({})\nLayers: {}\nFlows: {}\nSecrets declared: {}",
        name,
        lang,
        stack,
        arch,
        spec.entities.len(),
        spec.entities.join(", "),
        spec.layers.len(),
        spec.flows.len(),
        spec.secrets.len()
    );

    tool_ok(id, &summary)
}

fn tool_ok(id: &Value, text: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{"type": "text", "text": text}]
        }
    })
}

fn tool_error(id: &Value, msg: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{"type": "text", "text": msg}],
            "isError": true
        }
    })
}

fn error_response(id: &Value, code: i32, msg: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {"code": code, "message": msg}
    })
}
