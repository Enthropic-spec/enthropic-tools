![enthropic](assets/banner.svg)

[![CI](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/ci.yml/badge.svg)](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/ci.yml)
[![Lint](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/lint.yml/badge.svg)](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/lint.yml)
[![CodeQL](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/codeql.yml/badge.svg)](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/codeql.yml)
[![Security Scan](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/security-scan.yml/badge.svg)](https://github.com/enthropic-spec/enthropic-tools/actions/workflows/security-scan.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/Enthropic-spec/enthropic-tools/badge)](https://securityscorecards.dev/viewer/?uri=github.com/Enthropic-spec/enthropic-tools)
[![SLSA 3](https://slsa.dev/images/gh-badge-level3.svg)](https://slsa.dev)

CLI for the [Enthropic](https://github.com/enthropic-spec/enthropic) specification.  
True spec-driven development.

## Install

**npm (requires Node.js 20+):**
```bash
npm install -g enthropic
# or run without installing:
npx enthropic
```

**From source:**
```bash
git clone https://github.com/Enthropic-spec/enthropic-tools
cd enthropic-tools && npm install && npm run build && npm install -g .
```

## Workflow

```
enthropic setup         # one-time: store your API key encrypted
enthropic new           # guided wizard → creates enthropic.enth
enthropic validate      # validate spec → auto-creates state + vault + .gitignore
enthropic build         # AI spec consultant → design your .enth through conversation
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

enthropic serve                              # MCP server (stdio) — for Claude Desktop, Cursor, Docker
```

`[file]` defaults to `enthropic.enth` in the current directory.

## MCP Integration

`enthropic serve` implements the [Model Context Protocol](https://modelcontextprotocol.io) over stdio.
It exposes four tools that AI coders (Claude Desktop, Cursor, etc.) call automatically before generating code.

| Tool | Description |
|------|-------------|
| `read_spec` | Returns the raw `.enth` file |
| `get_context` | Returns spec + state formatted as AI system prompt |
| `validate_spec` | Validates the spec, returns any errors |
| `spec_summary` | Project name, language, stack, entity count |

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "enthropic": {
      "command": "enthropic",
      "args": ["serve"],
      "cwd": "/path/to/your/project"
    }
  }
}
```

### Docker

```bash
docker build -t enthropic .
docker run --rm -i -v /path/to/project:/project enthropic
```

```json
{
  "mcpServers": {
    "enthropic": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "-v", "/path/to/project:/project", "enthropic"]
    }
  }
}
```

Once configured, the AI reads your `.enth` automatically at the start of every session — no manual copy-paste.

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

## Roadmap

#### v0.1.0 — MVP ✅
- ✅ Parser and validator for the `.enth` format
- ✅ `enthropic validate` — full spec validation with error messages
- ✅ `enthropic context` — AI context block generation
- ✅ `enthropic new` — guided project creation wizard
- ✅ `enthropic build` — interactive AI build session
- ✅ `enthropic state` — build progress tracking
- ✅ `enthropic vault` — encrypted secrets (ChaCha20-Poly1305, never in repo)
- ✅ `enthropic setup` — BYOK API key configuration
- ✅ `enthropic serve` — MCP server over stdio (Claude Desktop, Cursor, Docker)
- ✅ SLSA Level 3 provenance on release
- ✅ Hardened CI (SHA-pinned actions, CodeQL, Trivy, OpenSSF Scorecard)

#### v0.2.0 — Distribution
- ⬜ Docker image signed with cosign → `ghcr.io/enthropic-spec/enthropic-tools`
- ⬜ Pre-built binaries on Releases — macOS arm64, Linux amd64, Windows amd64
- ⬜ Homebrew tap — `brew install enthropic-spec/tap/enthropic`
- ⬜ SBOM generated and attached to every release
- ⬜ `enthropic verify` — verify binary or image signature locally

#### v0.3.0 — Editor Integration
- ⬜ VS Code extension — syntax highlighting for `.enth`
- ⬜ VS Code validate on save with inline error markers
- ⬜ `enthropic lint` — warnings and improvement suggestions
- ⬜ LSP server for any editor

#### v0.4.0 — Security
- ⬜ `SECURITY` block support — parse and validate `AUTH`, `CORS`, `RATE_LIMIT`, `INPUT_VALIDATION`
- ⬜ Validator CVE checks on declared `DEPS` at parse time
- ⬜ Security context injected into every AI build session automatically
- ⬜ `enthropic audit` — standalone security report for a spec file

#### v0.5.0+ — Ecosystem
- ⬜ Template library — `enthropic init --template api|saas|cli|worker`
- ⬜ Community recipe collection — one `.enth` per project archetype
- ⬜ `enthropic recipes` — browse and pull community templates

## Spec

The `.enth` format is defined in [enthropic/SPEC.md](https://github.com/Enthropic-spec/enthropic/blob/main/SPEC.md).

---

[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-20+-brightgreen.svg)](https://nodejs.org)
