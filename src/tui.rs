use anyhow::Result;
use console::Style;
use dialoguer::{Confirm, Input, Password, Select};

const LOGO: &str = r"              __  __                     _     
  ___  ____  / /_/ /_  _________  ____  (_)____
 / _ \/ __ \/ __/ __ \/ ___/ __ \/ __ \/ / ___/
/  __/ / / / /_/ / / / /  / /_/ / /_/ / / /__  
\___/_/ /_/\__/_/ /_/_/   \____/ .___/_/\___/  
                              /_/              ";

const SEPARATOR: &str = "──────────────────────────────────────────────────────────────";

pub const fn pink() -> Style {
    // 219 = #ffafff — soft pink/rose, 211 = #ff87af — deeper pink
    Style::new().color256(219)
}

pub const fn dimmed() -> Style {
    Style::new().dim()
}

pub const fn bold_white() -> Style {
    Style::new().bold()
}

pub const fn success_green() -> Style {
    Style::new().green()
}

pub const fn error_red() -> Style {
    Style::new().red()
}

pub fn print_header() {
    let p = pink();
    for line in LOGO.lines() {
        println!("{}", p.apply_to(line));
    }
    println!(
        "🧠  {}          {}",
        dimmed().apply_to("true spec-driven development"),
        dimmed().apply_to("v0.1.0")
    );
    println!("{}", p.apply_to(SEPARATOR));
    println!();
}

pub fn print_success(msg: &str) {
    println!("{} {}", success_green().apply_to("✓"), msg);
}

pub fn print_error(msg: &str) {
    eprintln!("{} {}", error_red().apply_to("✗"), msg);
}

#[allow(dead_code)]
pub fn print_info(msg: &str) {
    println!("{}", bold_white().apply_to(msg));
}

pub fn print_dim(msg: &str) {
    println!("{}", dimmed().apply_to(msg));
}

pub fn confirm(prompt: &str) -> Result<bool> {
    let result = Confirm::new()
        .with_prompt(prompt)
        .default(false)
        .interact()?;
    Ok(result)
}

pub fn input(prompt: &str) -> Result<String> {
    let result: String = Input::new().with_prompt(prompt).interact_text()?;
    Ok(result)
}

pub fn input_with_default(prompt: &str, default: &str) -> Result<String> {
    let result: String = Input::new()
        .with_prompt(prompt)
        .default(default.to_string())
        .interact_text()?;
    Ok(result)
}

pub fn password(prompt: &str) -> Result<String> {
    let result = Password::new().with_prompt(prompt).interact()?;
    Ok(result)
}

pub fn select(prompt: &str, items: &[&str]) -> Result<usize> {
    let result = Select::new()
        .with_prompt(prompt)
        .items(items)
        .default(0)
        .interact()?;
    Ok(result)
}

#[allow(dead_code)]
pub fn select_string(prompt: &str, items: &[String]) -> Result<usize> {
    let refs: Vec<&str> = items.iter().map(std::string::String::as_str).collect();
    select(prompt, &refs)
}
