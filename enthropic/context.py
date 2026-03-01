from __future__ import annotations

from pathlib import Path

from .parser import EnthSpec

_PREAMBLE = """\
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

"""


def generate(spec: EnthSpec, state_path: Path | None = None) -> str:
    output = _PREAMBLE.format(version=spec.version or "0.1.0")
    output += Path(spec.source_file).read_text(encoding="utf-8")

    if state_path and state_path.exists():
        output += "\n\n=== CURRENT BUILD STATE ===\n\n"
        output += state_path.read_text(encoding="utf-8")
        output += "\n\nOnly implement entities, flows, and layers marked PENDING or PARTIAL."
        output += "\nDo not re-implement anything marked BUILT."

    return output
