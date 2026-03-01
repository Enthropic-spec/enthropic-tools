from __future__ import annotations

from pathlib import Path

from .parser import EnthSpec

STATUS_VALUES = {"BUILT", "PARTIAL", "PENDING", "OK", "MISSING", "UNVERIFIED", "SET", "UNSET"}


def generate(spec: EnthSpec, project_name: str) -> str:
    """Generate a structured state file from a spec. All items start as PENDING/UNVERIFIED."""
    lines = [f"STATE {project_name}", ""]

    # CHECKS — derived from LANG + DEPS.SYSTEM + DEPS.RUNTIME
    checks: list[tuple[str, str]] = []
    if spec.project.get("LANG"):
        checks.append((spec.project["LANG"], "LANG"))
    deps = spec.project.get("DEPS", {})
    for dep in deps.get("SYSTEM", []):
        checks.append((dep, "DEPS.SYSTEM"))
    for dep in deps.get("RUNTIME", []):
        checks.append((dep, "DEPS.RUNTIME"))

    if checks:
        lines.append("  CHECKS")
        for name, source in checks:
            lines.append(f"    {name:<28} UNVERIFIED   # {source}")
        lines.append("")

    if spec.entities:
        lines.append("  ENTITY")
        for entity in spec.entities:
            lines.append(f"    {entity:<28} PENDING")
        lines.append("")

    if spec.flows:
        lines.append("  FLOWS")
        for name in spec.flows:
            lines.append(f"    {name:<28} PENDING")
        lines.append("")

    if spec.layers:
        lines.append("  LAYERS")
        for name in spec.layers:
            lines.append(f"    {name:<28} PENDING")
        lines.append("")

    return "\n".join(lines)


def load(path: Path) -> dict:
    """Parse a state file into a dict of section -> {key: status}."""
    state: dict[str, dict[str, str]] = {"entity": {}, "flows": {}, "layers": {}}
    section: str | None = None

    for line in path.read_text(encoding="utf-8").splitlines():
        tok = line.strip()
        if not tok or tok.startswith("STATE "):
            continue
        if tok in ("ENTITY", "FLOWS", "LAYERS"):
            section = tok.lower()
            continue
        if section:
            parts = tok.split()
            if len(parts) == 2 and parts[1] in STATUS_VALUES:
                state[section][parts[0]] = parts[1]

    return state


def set_status(path: Path, key: str, status: str, section: str = "") -> None:
    """Update a single entry in the state file.

    key: the entity/flow/layer name
    status: BUILT | PARTIAL | PENDING
    """
    status = status.upper()
    if status not in STATUS_VALUES:
        raise ValueError(f"Invalid status '{status}'. Must be: {', '.join(sorted(STATUS_VALUES))}")

    lines = path.read_text(encoding="utf-8").splitlines()
    result = []
    updated = False

    for line in lines:
        tok = line.strip()
        parts = tok.split()
        if len(parts) == 2 and parts[0] == key and parts[1] in STATUS_VALUES:
            indent = line[: len(line) - len(line.lstrip())]
            result.append(f"{indent}{key:<28} {status}")
            updated = True
        else:
            result.append(line)

    if not updated:
        raise KeyError(f"Key '{key}' not found in state file")

    path.write_text("\n".join(result) + "\n", encoding="utf-8")
