use std::path::Path;
use anyhow::Result;
use crate::parser::EnthSpec;

const PREAMBLE_TEMPLATE: &str = "\
=== ENTHROPIC CONTEXT {version} ===

This project uses the Enthropic specification format.
Read the spec below before generating any code.
All architectural decisions declared here are final.

RULES:
  CONTEXT    — closed world. What is not declared does not exist.
               Do not invent entities, transforms, or relationships.
  CONTRACTS  — invariants. Violations are unacceptable, no exceptions, no workarounds.
  VOCABULARY — canonical names. Use them exactly in all code, comments, file names,
               variable names, and identifiers. Never use aliases or alternatives.
  LAYERS     — ownership boundaries. Never implement logic in a layer that does not own it.
               Never cross CALLS boundaries.
  FLOWS      — ordered sequences. Execute steps in declared order. Never skip or reorder.
               On failure, execute ROLLBACK in listed order.

=== PROJECT SPEC ===

";

pub fn generate(spec: &EnthSpec, state_path: Option<&Path>) -> Result<String> {
    let version = if spec.version.is_empty() { "0.1.0" } else { &spec.version };
    let preamble = PREAMBLE_TEMPLATE.replace("{version}", version);

    let spec_content = std::fs::read_to_string(&spec.source_file)?;
    let mut output = preamble + &spec_content;

    if let Some(sp) = state_path {
        if sp.exists() {
            let state_content = std::fs::read_to_string(sp)?;
            output.push_str("\n\n=== CURRENT BUILD STATE ===\n\n");
            output.push_str(&state_content);
            output.push_str("\n\nOnly implement entities, flows, and layers marked PENDING or PARTIAL.");
            output.push_str("\nDo not re-implement anything marked BUILT.");
        }
    }

    Ok(output)
}
