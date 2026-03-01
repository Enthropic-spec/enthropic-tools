# enthropic-tools

CLI for the [Enthropic](https://github.com/Enthropic-spec/enthropic) specification.  
Single binary. No runtime dependencies.

## Install

**From source** (requires Rust):
```bash
cargo install --path .
```

**Download binary** (macOS/Linux/Windows — see [Releases](https://github.com/Enthropic-spec/enthropic-tools/releases))

## Commands

```bash
enthropic validate [file]          # validate spec, auto-create state + vault
enthropic context  [file]          # print AI context block (spec + state)

enthropic state show    [file]     # show current build state
enthropic state set <entity> <status> [file]

enthropic vault set    <KEY> <VALUE> [file]
enthropic vault delete <KEY>         [file]
enthropic vault keys                 [file]   # names only — never values
enthropic vault export [--out .env]  [file]   # explicit decrypt
```

`[file]` defaults to `enthropic.enth` in the current directory.

## Workflow

```
write enthropic.enth
→ enthropic validate          creates state_[name].enth + vault_[name].enth + .gitignore
→ enthropic vault set KEY val encrypts to ~/.enthropic/[name].secrets, updates vault status
→ enthropic context           copy output → paste as AI context before generating code
→ AI generates code
→ enthropic state set user BUILT
```

## What validate produces

**`state_[name].enth`** — tracks build progress:
```
STATE myapp

  CHECKS
    python          UNVERIFIED   # LANG
    postgresql      UNVERIFIED   # DEPS.SYSTEM
    fastapi         UNVERIFIED   # DEPS.RUNTIME

  ENTITY
    user            PENDING

  FLOWS
    login           PENDING

  LAYERS
    API             PENDING
```

**`vault_[name].enth`** — secret key status, never values:
```
VAULT myapp

  DATABASE_URL      UNSET
  JWT_SECRET        SET
```

Values are encrypted with ChaCha20-Poly1305 in `~/.enthropic/[name].secrets`.  
Key in `~/.enthropic/[name].key` (chmod 600). Neither file is ever in the repo.

## Spec

The `.enth` format is defined in [enthropic/SPEC.md](https://github.com/Enthropic-spec/enthropic/blob/main/SPEC.md).
