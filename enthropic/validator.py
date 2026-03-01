from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from .parser import EnthSpec


@dataclass
class ValidationError:
    rule: int
    message: str
    severity: str = "ERROR"  # ERROR | WARNING


_UPPER = re.compile(r"^[A-Z][A-Z0-9_]*$")
_PASCAL = re.compile(r"^[A-Z][a-zA-Z0-9]*$")
_SNAKE = re.compile(r"^[a-z][a-z0-9_]*$")


def validate(spec: EnthSpec) -> list[ValidationError]:
    errors: list[ValidationError] = []
    entities = set(spec.entities)

    # 1 — VERSION must be present
    if not spec.version:
        errors.append(ValidationError(1, "VERSION is missing"))

    # 2 — ENTITY must declare at least one entity
    if not entities:
        errors.append(ValidationError(2, "ENTITY must declare at least one entity"))

    # 3 — TRANSFORM entities must be declared
    for t in spec.transforms:
        for name in (t.source, t.target):
            if name not in entities:
                errors.append(ValidationError(3, f"TRANSFORM references undeclared entity '{name}'"))

    # 4 — CONTRACT subjects must reference declared entities (or wildcard)
    for c in spec.contracts:
        base = c.subject.split(".")[0]
        if base not in entities:
            errors.append(ValidationError(4, f"CONTRACTS subject '{c.subject}' references undeclared entity '{base}'"))

    # 5 — FLOW step entities must be declared
    for flow in spec.flows.values():
        for step in flow.steps:
            if step.subject and step.subject not in entities:
                errors.append(ValidationError(5, f"FLOW '{flow.name}' step {step.number} references undeclared entity '{step.subject}'"))

    # 6 — FLOW steps must be sequential from 1
    for flow in spec.flows.values():
        nums = [s.number for s in flow.steps]
        if nums != list(range(1, len(nums) + 1)):
            errors.append(ValidationError(6, f"FLOW '{flow.name}' steps are not sequential from 1: {nums}"))

    # 7 — FLOW must have at least 2 steps
    for flow in spec.flows.values():
        if len(flow.steps) < 2:
            errors.append(ValidationError(7, f"FLOW '{flow.name}' must have at least 2 steps (has {len(flow.steps)})"))

    # 8 — LAYERS names must be UPPER_CASE
    for name in spec.layers:
        if not _UPPER.match(name):
            errors.append(ValidationError(8, f"LAYERS name must be UPPER_CASE: '{name}'"))

    # 9 — VOCABULARY entries must be PascalCase
    for entry in spec.vocabulary:
        if not _PASCAL.match(entry):
            errors.append(ValidationError(9, f"VOCABULARY entry must be PascalCase: '{entry}'"))

    # 10 — ENTITY identifiers must be snake_case
    for entity in spec.entities:
        if not _SNAKE.match(entity):
            errors.append(ValidationError(10, f"ENTITY identifier must be snake_case: '{entity}'"))

    # 11 — VAULT blocks must not appear in enthropic.enth
    if spec.source_file.endswith("enthropic.enth"):
        raw = Path(spec.source_file).read_text(encoding="utf-8")
        for lineno, line in enumerate(raw.splitlines(), 1):
            if line.strip().startswith("VAULT "):
                errors.append(ValidationError(11, f"VAULT block in enthropic.enth at line {lineno} — secrets must live in vault_*.enth"))

    # 12 — LAYERS CALLS may only reference declared layer names
    declared = set(spec.layers.keys())
    for layer in spec.layers.values():
        for ref in layer.calls:
            if ref not in declared:
                errors.append(ValidationError(12, f"LAYERS '{layer.name}' CALLS undeclared layer '{ref}'"))

    return errors
