from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ── helpers ───────────────────────────────────────────────────────────────────

def _strip_comment(line: str) -> str:
    idx = line.find("#")
    return line[:idx] if idx != -1 else line


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" \t"))


def _list(s: str) -> list[str]:
    return [x.strip() for x in s.split(",") if x.strip()]


# ── data model ────────────────────────────────────────────────────────────────

@dataclass
class Transform:
    source: str
    target: str
    actions: list[str]


@dataclass
class Layer:
    name: str
    owns: list[str] = field(default_factory=list)
    can: list[str] = field(default_factory=list)
    cannot: list[str] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)
    never: list[str] = field(default_factory=list)
    latency: Optional[str] = None


@dataclass
class Contract:
    subject: str
    keyword: str   # ALWAYS | NEVER | REQUIRES
    qualifier: str


@dataclass
class FlowStep:
    number: int
    subject: str
    action: str


@dataclass
class Flow:
    name: str
    steps: list[FlowStep] = field(default_factory=list)
    rollback: list[str] = field(default_factory=list)
    atomic: Optional[bool] = None
    timeout: Optional[str] = None
    retry: Optional[int] = None


@dataclass
class EnthSpec:
    source_file: str
    version: str = ""
    project: dict = field(default_factory=dict)
    vocabulary: list[str] = field(default_factory=list)
    entities: list[str] = field(default_factory=list)
    transforms: list[Transform] = field(default_factory=list)
    layers: dict[str, Layer] = field(default_factory=dict)
    contracts: list[Contract] = field(default_factory=list)
    flows: dict[str, Flow] = field(default_factory=dict)


# ── parser entry point ────────────────────────────────────────────────────────

def parse(path: Path) -> EnthSpec:
    spec = EnthSpec(source_file=str(path))
    lines = path.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lines):
        clean = _strip_comment(lines[i])
        tok = clean.strip()
        if not tok:
            i += 1
            continue
        ind = _indent(clean)
        if ind > 0:
            i += 1
            continue
        # top-level keyword dispatch
        if tok.startswith("VERSION "):
            spec.version = tok[8:].strip()
            i += 1
        elif tok == "PROJECT":
            i = _parse_project(lines, i + 1, spec)
        elif tok == "VOCABULARY":
            i = _parse_vocabulary(lines, i + 1, spec)
        elif tok.startswith("ENTITY "):
            spec.entities = _list(tok[7:])
            i += 1
        elif tok == "TRANSFORM":
            i = _parse_transform(lines, i + 1, spec)
        elif tok == "LAYERS":
            i = _parse_layers(lines, i + 1, spec)
        elif tok == "CONTRACTS":
            i = _parse_contracts(lines, i + 1, spec)
        else:
            i += 1
    return spec


# ── block parsers ─────────────────────────────────────────────────────────────

def _parse_project(lines: list[str], start: int, spec: EnthSpec) -> int:
    i = start
    while i < len(lines):
        clean = _strip_comment(lines[i])
        tok = clean.strip()
        if not tok:
            i += 1
            continue
        if _indent(clean) == 0:
            return i
        parts = tok.split(None, 1)
        if len(parts) == 2:
            key, val = parts[0], parts[1].strip('"').strip()
            spec.project[key] = _list(val) if key == "STACK" else val
        i += 1
    return i


def _parse_vocabulary(lines: list[str], start: int, spec: EnthSpec) -> int:
    i = start
    while i < len(lines):
        clean = _strip_comment(lines[i])
        tok = clean.strip()
        if not tok:
            i += 1
            continue
        if _indent(clean) == 0:
            return i
        spec.vocabulary.append(tok.split()[0])
        i += 1
    return i


def _parse_transform(lines: list[str], start: int, spec: EnthSpec) -> int:
    i = start
    while i < len(lines):
        clean = _strip_comment(lines[i])
        tok = clean.strip()
        if not tok:
            i += 1
            continue
        if _indent(clean) == 0:
            return i
        if "->" in tok and ":" in tok:
            arrow, actions = tok.split(":", 1)
            parts = arrow.split("->")
            if len(parts) == 2:
                spec.transforms.append(Transform(
                    source=parts[0].strip(),
                    target=parts[1].strip(),
                    actions=_list(actions),
                ))
        i += 1
    return i


def _parse_layers(lines: list[str], start: int, spec: EnthSpec) -> int:
    i = start
    current: Optional[Layer] = None
    while i < len(lines):
        clean = _strip_comment(lines[i])
        tok = clean.strip()
        if not tok:
            i += 1
            continue
        ind = _indent(clean)
        if ind == 0:
            return i
        if ind <= 2:   # layer name
            current = Layer(name=tok)
            spec.layers[tok] = current
        elif current:  # layer key-value
            parts = tok.split(None, 1)
            if len(parts) == 2:
                key, val = parts[0], parts[1].strip()
                if key == "OWNS":
                    current.owns = _list(val)
                elif key == "CAN":
                    current.can = _list(val)
                elif key == "CANNOT":
                    current.cannot = _list(val)
                elif key == "CALLS":
                    current.calls = _list(val)
                elif key == "NEVER":
                    current.never.append(val)
                elif key == "LATENCY":
                    current.latency = val
        i += 1
    return i


def _parse_contracts(lines: list[str], start: int, spec: EnthSpec) -> int:
    i = start
    current_flow: Optional[Flow] = None
    while i < len(lines):
        clean = _strip_comment(lines[i])
        tok = clean.strip()
        if not tok:
            i += 1
            continue
        ind = _indent(clean)
        if ind == 0:
            return i
        if ind <= 2:
            if tok.startswith("FLOW "):
                name = tok[5:].strip()
                current_flow = Flow(name=name)
                spec.flows[name] = current_flow
            else:
                current_flow = None
                parts = tok.split(None, 2)
                if len(parts) == 3:
                    subj, kw, qual = parts
                    if kw in ("ALWAYS", "NEVER", "REQUIRES"):
                        spec.contracts.append(Contract(subject=subj, keyword=kw, qualifier=qual))
        elif current_flow:
            tokens = tok.split(None, 1)
            if not tokens:
                i += 1
                continue
            first = tokens[0]
            rest = tokens[1].strip() if len(tokens) > 1 else ""
            # flow step: "N. subject.action"
            if first.endswith(".") and first[:-1].isdigit():
                num = int(first[:-1])
                if "." in rest:
                    subj, act = rest.split(".", 1)
                    current_flow.steps.append(FlowStep(number=num, subject=subj.strip(), action=act.strip()))
                else:
                    current_flow.steps.append(FlowStep(number=num, subject="", action=rest))
            # flow meta
            elif first == "ROLLBACK":
                current_flow.rollback = _list(rest)
            elif first == "ATOMIC":
                current_flow.atomic = rest.lower() == "true"
            elif first == "TIMEOUT":
                current_flow.timeout = rest
            elif first == "RETRY":
                try:
                    current_flow.retry = int(rest)
                except ValueError:
                    pass
        i += 1
    return i
