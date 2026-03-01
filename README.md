![enthropic](assets/banner.svg)

CLI for the [Enthropic](https://github.com/Enthropic-spec/enthropic) specification.  
Single binary. No runtime dependencies.

## Install

**From source** (requires Rust):
```bash
cargo install --git https://github.com/Enthropic-spec/enthropic-tools
```

**Download binary** — see [Releases](https://github.com/Enthropic-spec/enthropic-tools/releases) (macOS · Linux · Windows)

## Workflow

```
enthropic setup         # one-time: store your API key encrypted
enthropic new           # guided wizard → creates enthropic.enth
enthropic validate      # validate spec → auto-creates state + vault + .gitignore
enthropic build         # AI chat with your spec pre-loaded as context
```

## Commands

```bash
enthropic setup                          # configure provider + API key + model
enthropic new                            # guided .enth creation wizard

enthropic validate [file]                # validate spec, auto-create state + vault
enthropic context  [file]                # print full AI context block

enthropic state show    [file]
enthropic state set <entity> <status> [file]

enthropic vault set    <KEY> <VALUE> [file]
enthropic vault delete <KEY>         [file]
enthropic vault keys                 [file]   # names only — never values
enthropic vault export [--out .env]  [file]   # explicit decrypt only
```

`[file]` defaults to `enthropic.enth` in the current directory.

## Generated files

Running `enthropic validate` on a valid spec produces three files automatically.

**`state_[name].enth`** — build progress. Updated as you work.
```
STATE myapp

  CHECKS
    python            UNVERIFIED   # LANG
    postgresql        UNVERIFIED   # DEPS.SYSTEM
    fastapi           UNVERIFIED   # DEPS.RUNTIME
    pydantic          UNVERIFIED   # DEPS.RUNTIME

  ENTITY
    user              PENDING
    session           PENDING
    order             PENDING

  FLOWS
    login             PENDING
    checkout          PENDING

  LAYERS
    API               PENDING
    SERVICE           PENDING
    REPOSITORY        PENDING
```

**`vault_[name].enth`** — secret key status. Never contains values.
```
VAULT myapp

  DATABASE_URL        UNSET
  JWT_SECRET          SET
  STRIPE_KEY          UNSET
```

**`.gitignore`** — auto-created to exclude `state_*.enth`, `vault_*.enth`, `.env`.

Actual secret values live encrypted in `~/.enthropic/[name].secrets` (ChaCha20-Poly1305).  
The encryption key is in `~/.enthropic/[name].key` (chmod 600). Neither is ever in the repo.

## Security model

| What | Where | In repo? |
|---|---|---|
| Secret key names | `enthropic.enth` SECRETS block | ✅ yes |
| Key status (SET/UNSET) | `vault_[name].enth` | ❌ gitignored |
| Encrypted values | `~/.enthropic/[name].secrets` | ❌ never |
| Encryption key | `~/.enthropic/[name].key` chmod 600 | ❌ never |
| API key (BYOK) | `~/.enthropic/global.keys` encrypted | ❌ never |

## Spec

The `.enth` format is defined in [enthropic/SPEC.md](https://github.com/Enthropic-spec/enthropic/blob/main/SPEC.md).
