from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.table import Table
from rich import print as rprint

from .parser import parse
from .validator import validate as validate_spec
from . import state as state_mod
from . import vault as vault_mod
from . import context as context_mod

app = typer.Typer(
    name="enthropic",
    help="Enthropic — toolkit for the .enth architectural specification format.",
    no_args_is_help=True,
)
state_app = typer.Typer(help="Manage project build state.", no_args_is_help=True)
vault_app = typer.Typer(help="Manage project secrets (encrypted vault).", no_args_is_help=True)
app.add_typer(state_app, name="state")
app.add_typer(vault_app, name="vault")

console = Console()


# ── helpers ───────────────────────────────────────────────────────────────────

def _resolve_spec(path: Optional[Path]) -> Path:
    if path and path.exists():
        return path
    default = Path("enthropic.enth")
    if default.exists():
        return default
    raise typer.BadParameter(
        "No .enth file specified and enthropic.enth not found in the current directory."
    )


def _project_name(path: Path) -> str:
    spec = parse(path)
    raw = spec.project.get("NAME", path.stem)
    return raw.strip('"').lower().replace(" ", "_")


# ── validate ──────────────────────────────────────────────────────────────────

@app.command("validate")
def cmd_validate(
    file: Optional[Path] = typer.Argument(None, help=".enth file to validate"),
):
    """Validate an .enth file against the Enthropic specification rules.

    Also auto-creates state and vault files if they do not exist yet.
    """
    path = _resolve_spec(file)
    spec = parse(path)
    errors = validate_spec(spec)

    if errors:
        table = Table(show_header=True, header_style="bold")
        table.add_column("Rule", style="dim", width=6)
        table.add_column("Severity", width=9)
        table.add_column("Message")
        for e in errors:
            color = "red" if e.severity == "ERROR" else "yellow"
            table.add_row(str(e.rule), f"[{color}]{e.severity}[/{color}]", e.message)
        console.print(table)
        raise typer.Exit(1)

    rprint(f"[green]✓[/green] {path} — valid")

    name = _project_name(path)

    # auto-create state file if missing
    state_path = path.parent / f"state_{name}.enth"
    if not state_path.exists():
        content = state_mod.generate(spec, name)
        state_path.write_text(content, encoding="utf-8")
        rprint(f"[dim]  created {state_path.name}[/dim]")

    # always regenerate vault status file from SECRETS in spec
    vault_path = path.parent / f"vault_{name}.enth"
    vault_existed = vault_path.exists()
    vault_mod.refresh_vault_file(name, spec.secrets, path.parent)
    rprint(f"[dim]  {'updated' if vault_existed else 'created'} {vault_path.name}[/dim]")

    # auto-create .gitignore if missing
    gitignore_path = path.parent / ".gitignore"
    if not gitignore_path.exists():
        gitignore_path.write_text("vault_*.enth\nstate_*.enth\n.env\n", encoding="utf-8")
        rprint(f"[dim]  created .gitignore[/dim]")
    else:
        existing = gitignore_path.read_text(encoding="utf-8")
        additions = [e for e in ("vault_*.enth", "state_*.enth") if e not in existing]
        if additions:
            gitignore_path.write_text(existing.rstrip() + "\n" + "\n".join(additions) + "\n", encoding="utf-8")
            rprint(f"[dim]  updated .gitignore[/dim]")

    raise typer.Exit(0)


# ── context ───────────────────────────────────────────────────────────────────

@app.command("context")
def cmd_context(
    file: Optional[Path] = typer.Argument(None, help=".enth spec file"),
    state: Optional[Path] = typer.Option(None, "--state", "-s", help="state file to include"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="write output to file"),
):
    """Generate the context block to paste as AI system prompt."""
    path = _resolve_spec(file)
    spec = parse(path)

    # auto-detect state file
    if state is None:
        name = _project_name(path)
        candidate = path.parent / f"state_{name}.enth"
        if candidate.exists():
            state = candidate

    result = context_mod.generate(spec, state)

    if out:
        out.write_text(result, encoding="utf-8")
        rprint(f"[green]✓[/green] Context written to {out}")
    else:
        print(result)


# ── state ─────────────────────────────────────────────────────────────────────

@state_app.command("init")
def cmd_state_init(
    file: Optional[Path] = typer.Argument(None, help=".enth spec file"),
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="output path"),
):
    """Generate a fresh state file from the spec. All items start as PENDING."""
    path = _resolve_spec(file)
    spec = parse(path)
    name = _project_name(path)

    content = state_mod.generate(spec, name)
    dest = out or (path.parent / f"state_{name}.enth")
    dest.write_text(content, encoding="utf-8")
    rprint(f"[green]✓[/green] State file created: {dest}")


@state_app.command("set")
def cmd_state_set(
    key: str = typer.Argument(..., help="Key to update (e.g. 'order', 'checkout', 'BACKEND')"),
    status: str = typer.Argument(..., help="New status: BUILT | PARTIAL | PENDING"),
    state: Optional[Path] = typer.Option(None, "--state", "-s", help="state file path"),
    file: Optional[Path] = typer.Option(None, "--spec", help=".enth spec file"),
):
    """Update a single entry's status in the state file."""
    spec_path = _resolve_spec(file)
    name = _project_name(spec_path)
    state_path = state or (spec_path.parent / f"state_{name}.enth")

    if not state_path.exists():
        rprint(f"[red]✗[/red] State file not found: {state_path}. Run 'enthropic state init' first.")
        raise typer.Exit(1)

    try:
        state_mod.set_status(state_path, key=key, status=status.upper())
        rprint(f"[green]✓[/green] {key} → {status.upper()}")
    except (KeyError, ValueError) as e:
        rprint(f"[red]✗[/red] {e}")
        raise typer.Exit(1)


@state_app.command("show")
def cmd_state_show(
    file: Optional[Path] = typer.Argument(None, help="state file or spec file"),
):
    """Show the current build state."""
    # accept either a state file or a spec file
    if file and file.name.startswith("state_"):
        state_path = file
    else:
        spec_path = _resolve_spec(file)
        name = _project_name(spec_path)
        state_path = spec_path.parent / f"state_{name}.enth"

    if not state_path.exists():
        rprint("[red]✗[/red] No state file found. Run 'enthropic state init' first.")
        raise typer.Exit(1)

    print(state_path.read_text(encoding="utf-8"))


# ── vault ─────────────────────────────────────────────────────────────────────

def _vault_project(file: Optional[Path]) -> tuple[str, Path, list[str]]:
    spec_path = _resolve_spec(file)
    spec = parse(spec_path)
    return _project_name(spec_path), spec_path.parent, spec.secrets


@vault_app.command("set")
def cmd_vault_set(
    key: str = typer.Argument(..., help="Secret key name"),
    value: str = typer.Argument(..., help="Secret value"),
    file: Optional[Path] = typer.Option(None, "--spec", help=".enth spec file"),
):
    """Store a secret in the encrypted vault."""
    project, directory, secret_names = _vault_project(file)
    try:
        vault_mod.set_secret(project, key, value, directory, secret_names)
        rprint(f"[green]✓[/green] {key} → SET in vault_{project}.enth")
    except RuntimeError as e:
        rprint(f"[red]✗[/red] {e}")
        raise typer.Exit(1)


@vault_app.command("delete")
def cmd_vault_delete(
    key: str = typer.Argument(..., help="Secret key to remove"),
    file: Optional[Path] = typer.Option(None, "--spec", help=".enth spec file"),
):
    """Remove a secret from the vault."""
    project, directory, secret_names = _vault_project(file)
    try:
        vault_mod.delete_secret(project, key, directory, secret_names)
        rprint(f"[green]✓[/green] {key} → UNSET")
    except (RuntimeError, KeyError) as e:
        rprint(f"[red]✗[/red] {e}")
        raise typer.Exit(1)


@vault_app.command("keys")
def cmd_vault_keys(
    file: Optional[Path] = typer.Option(None, "--spec", help=".enth spec file"),
):
    """List all key names in the vault. Values are never shown."""
    project, directory, _ = _vault_project(file)
    try:
        keys = vault_mod.list_keys(project, directory)
        if not keys:
            rprint("[dim]No secrets set yet.[/dim]")
        for k in keys:
            rprint(f"  [cyan]{k}[/cyan]  [green]SET[/green]")
    except RuntimeError as e:
        rprint(f"[red]✗[/red] {e}")
        raise typer.Exit(1)


@vault_app.command("export")
def cmd_vault_export(
    out: Optional[Path] = typer.Option(None, "--out", "-o", help="Write to .env file"),
    file: Optional[Path] = typer.Option(None, "--spec", help=".enth spec file"),
):
    """Export vault contents as .env (decrypted). Explicit action only."""
    project, directory, _ = _vault_project(file)
    try:
        result = vault_mod.export_env(project, directory)
        if out:
            out.write_text(result, encoding="utf-8")
            rprint(f"[green]✓[/green] Exported to {out}")
        else:
            print(result)
    except RuntimeError as e:
        rprint(f"[red]✗[/red] {e}")
        raise typer.Exit(1)
