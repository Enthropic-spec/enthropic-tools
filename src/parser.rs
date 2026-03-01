use anyhow::{Context as _, Result};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Transform {
    pub source: String,
    pub target: String,
    #[allow(dead_code)]
    pub actions: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct Layer {
    pub name: String,
    pub owns: Vec<String>,
    pub can: Vec<String>,
    pub cannot: Vec<String>,
    pub calls: Vec<String>,
    pub never: Vec<String>,
    pub latency: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Contract {
    pub subject: String,
    #[allow(dead_code)]
    pub keyword: String,
    #[allow(dead_code)]
    pub qualifier: String,
}

#[derive(Debug, Clone)]
pub struct FlowStep {
    pub number: usize,
    pub subject: String,
    #[allow(dead_code)]
    pub action: String,
}

#[derive(Debug, Clone, Default)]
pub struct Flow {
    pub name: String,
    pub steps: Vec<FlowStep>,
    pub rollback: Vec<String>,
    pub atomic: Option<bool>,
    pub timeout: Option<String>,
    pub retry: Option<i32>,
}

#[derive(Debug, Clone)]
pub enum ProjectValue {
    Str(String),
    List(Vec<String>),
    Deps(HashMap<String, Vec<String>>),
}

#[derive(Debug, Clone, Default)]
pub struct EnthSpec {
    pub source_file: PathBuf,
    pub version: String,
    pub project: HashMap<String, ProjectValue>,
    pub vocabulary: Vec<String>,
    pub entities: Vec<String>,
    pub transforms: Vec<Transform>,
    pub layers: HashMap<String, Layer>,
    pub layers_order: Vec<String>,
    pub contracts: Vec<Contract>,
    pub flows: HashMap<String, Flow>,
    pub flows_order: Vec<String>,
    pub secrets: Vec<String>,
}

fn strip_comment(line: &str) -> &str {
    if let Some(idx) = line.find('#') {
        &line[..idx]
    } else {
        line
    }
}

fn indent_len(line: &str) -> usize {
    line.len() - line.trim_start_matches([' ', '\t']).len()
}

pub fn split_list(s: &str) -> Vec<String> {
    s.split(',')
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

pub fn parse(path: &Path) -> Result<EnthSpec> {
    let content = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let lines: Vec<&str> = content.lines().collect();
    let mut spec = EnthSpec {
        source_file: path.to_path_buf(),
        ..Default::default()
    };

    let mut i = 0;
    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        let ind = indent_len(clean);
        if ind > 0 {
            i += 1;
            continue;
        }
        if let Some(stripped) = tok.strip_prefix("VERSION ") {
            spec.version = stripped.trim().to_string();
            i += 1;
        } else if tok == "PROJECT" || tok.starts_with("PROJECT ") {
            if let Some(stripped) = tok.strip_prefix("PROJECT ") {
                let name = stripped.trim().to_string();
                spec.project
                    .entry("NAME".to_string())
                    .or_insert(ProjectValue::Str(name));
            }
            i = parse_project(&lines, i + 1, &mut spec);
        } else if tok == "VOCABULARY" {
            i = parse_vocabulary(&lines, i + 1, &mut spec);
        } else if let Some(stripped) = tok.strip_prefix("ENTITY ") {
            spec.entities = split_list(stripped);
            i += 1;
        } else if tok == "TRANSFORM" {
            i = parse_transform(&lines, i + 1, &mut spec);
        } else if tok == "LAYERS" {
            i = parse_layers(&lines, i + 1, &mut spec);
        } else if tok == "CONTRACTS" {
            i = parse_contracts(&lines, i + 1, &mut spec);
        } else if tok == "SECRETS" {
            i = parse_secrets(&lines, i + 1, &mut spec);
        } else {
            i += 1;
        }
    }
    Ok(spec)
}

fn parse_project(lines: &[&str], start: usize, spec: &mut EnthSpec) -> usize {
    let mut i = start;
    let mut in_deps = false;
    let mut deps_map: HashMap<String, Vec<String>> = HashMap::new();

    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        let ind = indent_len(clean);
        if ind == 0 {
            if !deps_map.is_empty() {
                spec.project
                    .insert("DEPS".to_string(), ProjectValue::Deps(deps_map));
            }
            return i;
        }
        if ind <= 2 {
            in_deps = tok == "DEPS";
            if !in_deps {
                if let Some((key, val)) = tok.split_once(|c: char| c.is_whitespace()) {
                    let key = key.trim().to_string();
                    let val = val.trim().trim_matches('"').trim().to_string();
                    if key == "STACK" {
                        spec.project
                            .insert(key, ProjectValue::List(split_list(&val)));
                    } else {
                        spec.project.insert(key, ProjectValue::Str(val));
                    }
                }
            }
        } else if in_deps {
            if let Some((dep_key, val)) = tok.split_once(|c: char| c.is_whitespace()) {
                let dep_key = dep_key.trim().to_string();
                let val = val.trim();
                if matches!(dep_key.as_str(), "SYSTEM" | "RUNTIME" | "DEV") {
                    deps_map.insert(dep_key, split_list(val));
                }
            }
        }
        i += 1;
    }
    if !deps_map.is_empty() {
        spec.project
            .insert("DEPS".to_string(), ProjectValue::Deps(deps_map));
    }
    i
}

fn parse_vocabulary(lines: &[&str], start: usize, spec: &mut EnthSpec) -> usize {
    let mut i = start;
    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        if indent_len(clean) == 0 {
            return i;
        }
        if let Some(first) = tok.split_whitespace().next() {
            spec.vocabulary.push(first.to_string());
        }
        i += 1;
    }
    i
}

fn parse_transform(lines: &[&str], start: usize, spec: &mut EnthSpec) -> usize {
    let mut i = start;
    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        if indent_len(clean) == 0 {
            return i;
        }
        if tok.contains("->") && tok.contains(':') {
            if let Some((arrow, actions_str)) = tok.split_once(':') {
                let parts: Vec<&str> = arrow.split("->").collect();
                if parts.len() == 2 {
                    spec.transforms.push(Transform {
                        source: parts[0].trim().to_string(),
                        target: parts[1].trim().to_string(),
                        actions: split_list(actions_str),
                    });
                }
            }
        }
        i += 1;
    }
    i
}

fn parse_layers(lines: &[&str], start: usize, spec: &mut EnthSpec) -> usize {
    let mut i = start;
    let mut current: Option<String> = None;

    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        let ind = indent_len(clean);
        if ind == 0 {
            return i;
        }
        if ind <= 2 {
            let name = tok.to_string();
            current = Some(name.clone());
            spec.layers_order.push(name.clone());
            spec.layers.insert(
                name.clone(),
                Layer {
                    name,
                    ..Default::default()
                },
            );
        } else if let Some(ref cur_name) = current.clone() {
            if let Some((key, val)) = tok.split_once(|c: char| c.is_whitespace()) {
                let val = val.trim().to_string();
                if let Some(layer) = spec.layers.get_mut(cur_name) {
                    match key {
                        "OWNS" => layer.owns = split_list(&val),
                        "CAN" => layer.can = split_list(&val),
                        "CANNOT" => layer.cannot = split_list(&val),
                        "CALLS" => layer.calls = split_list(&val),
                        "NEVER" => layer.never.push(val),
                        "LATENCY" => layer.latency = Some(val),
                        _ => {}
                    }
                }
            }
        }
        i += 1;
    }
    i
}

fn parse_contracts(lines: &[&str], start: usize, spec: &mut EnthSpec) -> usize {
    let mut i = start;
    let mut current_flow: Option<String> = None;

    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        let ind = indent_len(clean);
        if ind == 0 {
            return i;
        }
        if ind <= 2 {
            if let Some(stripped) = tok.strip_prefix("FLOW ") {
                let name = stripped.trim().to_string();
                current_flow = Some(name.clone());
                spec.flows_order.push(name.clone());
                spec.flows.insert(
                    name.clone(),
                    Flow {
                        name,
                        ..Default::default()
                    },
                );
            } else {
                current_flow = None;
                let parts: Vec<&str> = tok.split_whitespace().collect();
                if parts.len() >= 3 {
                    let subj = parts[0].to_string();
                    let kw = parts[1].to_string();
                    let qual = parts[2..].join(" ");
                    if matches!(kw.as_str(), "ALWAYS" | "NEVER" | "REQUIRES") {
                        spec.contracts.push(Contract {
                            subject: subj,
                            keyword: kw,
                            qualifier: qual,
                        });
                    }
                }
            }
        } else if let Some(ref flow_name) = current_flow.clone() {
            let (first, rest) = tok
                .split_once(|c: char| c.is_whitespace())
                .map(|(f, r)| (f.trim(), r.trim()))
                .unwrap_or((tok, ""));

            if first.ends_with('.') && first[..first.len() - 1].chars().all(|c| c.is_ascii_digit())
            {
                let num: usize = first[..first.len() - 1].parse().unwrap_or(0);
                if let Some(dot_pos) = rest.find('.') {
                    let subj = rest[..dot_pos].trim().to_string();
                    let act = rest[dot_pos + 1..].trim().to_string();
                    if let Some(flow) = spec.flows.get_mut(flow_name) {
                        flow.steps.push(FlowStep {
                            number: num,
                            subject: subj,
                            action: act,
                        });
                    }
                } else if let Some(flow) = spec.flows.get_mut(flow_name) {
                    flow.steps.push(FlowStep {
                        number: num,
                        subject: String::new(),
                        action: rest.to_string(),
                    });
                }
            } else {
                match first {
                    "ROLLBACK" => {
                        if let Some(flow) = spec.flows.get_mut(flow_name) {
                            flow.rollback = split_list(rest);
                        }
                    }
                    "ATOMIC" => {
                        if let Some(flow) = spec.flows.get_mut(flow_name) {
                            flow.atomic = Some(rest.to_lowercase() == "true");
                        }
                    }
                    "TIMEOUT" => {
                        if let Some(flow) = spec.flows.get_mut(flow_name) {
                            flow.timeout = Some(rest.to_string());
                        }
                    }
                    "RETRY" => {
                        if let Ok(n) = rest.parse::<i32>() {
                            if let Some(flow) = spec.flows.get_mut(flow_name) {
                                flow.retry = Some(n);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        i += 1;
    }
    i
}

fn parse_secrets(lines: &[&str], start: usize, spec: &mut EnthSpec) -> usize {
    let mut i = start;
    while i < lines.len() {
        let clean = strip_comment(lines[i]);
        let tok = clean.trim();
        if tok.is_empty() {
            i += 1;
            continue;
        }
        if indent_len(clean) == 0 {
            return i;
        }
        if let Some(first) = tok.split_whitespace().next() {
            spec.secrets.push(first.to_string());
        }
        i += 1;
    }
    i
}
