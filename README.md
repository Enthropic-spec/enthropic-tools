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
enthropic setup         # one-time: configure AI provider + API key
enthropic new           # AI-guided wizard → creates spec, state, vault in project folder
enthropic check         # validate + lint in one view — errors (V) and warnings (L)
enthropic update        # refine an existing spec with AI
enthropic context       # spec + state → AI context block (opens in pager)
```

## Commands

```bash
enthropic setup                    # configure provider + API key + model
enthropic open                     # open a project spec in $EDITOR

enthropic new                      # guided project creation (AI conversation)
enthropic update   [file]          # refine existing spec with AI
enthropic reverse  [dir]           # reverse-engineer a codebase into a starter .enth

enthropic check    [file]          # full check: errors + warnings, grouped by severity
enthropic context  [file]          # spec + state → AI context block (pager view)

enthropic state    show    [file]
enthropic state    set <entity> <status> [file]

enthropic vault    set    <KEY>         [file]
enthropic vault    delete <KEY>         [file]
enthropic vault    keys                 [file]   # names only — never values
enthropic vault    export [--out .env]  [file]   # explicit decrypt only

enthropic serve                         # MCP server (stdio) — Claude Desktop, Cursor, Docker
enthropic delete                        # delete a project folder entirely
```

`[file]` defaults to the `.enth` file inside `~/.enthropic/workspace/<project>/`.

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
- ✅ `enthropic check` — merged validate + lint, single view with ERROR/WARN grouped by severity
- ✅ `enthropic context` — AI context block generation (pager view)
- ✅ `enthropic new` — AI-guided project wizard with project folder structure
- ✅ `enthropic update` — interactive AI refinement session for existing specs
- ✅ `enthropic reverse` — reverse-engineer a codebase into a starter spec
- ✅ `enthropic state` — build progress tracking with project picker
- ✅ `enthropic vault` — encrypted secrets (ChaCha20-Poly1305, never in repo)
- ✅ `enthropic setup` — BYOK API key configuration (OpenAI, Anthropic, OpenRouter)
- ✅ `enthropic serve` — MCP server over stdio (Claude Desktop, Cursor, Docker)
- ✅ `enthropic open` / `enthropic delete` — project management
- ✅ Post-check AI refine flow — errors passed as context to the AI session automatically
- ✅ SLSA Level 3 provenance on release
- ✅ Hardened CI (SHA-pinned actions, CodeQL, Trivy, OpenSSF Scorecard)

#### v0.2.0 — Distribution
- ⬜ Docker image signed with cosign → `ghcr.io/enthropic-spec/enthropic-tools`
- ⬜ npm publish — `npm install -g enthropic` (verify name availability, smoke tests first)
- ⬜ Pre-built binaries on Releases — macOS arm64, Linux amd64, Windows amd64
- ⬜ Homebrew tap — `brew install enthropic-spec/tap/enthropic`
- ⬜ SBOM generated and attached to every release
- ⬜ `enthropic verify` — verify binary or image signature locally

#### v0.3.0 — Integrations
- ⬜ **Webhook / bot integration** — HTTP endpoint that receives events (GitHub PR merged, deploy succeeded) and auto-updates project state; Slack/Discord bot that posts check results and state diffs
- ⬜ GitHub Action — `enthropic check` as a CI step; fails PR if spec has errors
- ⬜ `enthropic watch` — file watcher that runs check on `.enth` save and reports live
- ⬜ VS Code extension — syntax highlighting, validate on save, inline error markers
- ⬜ LSP server for any editor

#### v0.4.0 — Security
- ⬜ `SECURITY` block support — parse and validate `AUTH`, `CORS`, `RATE_LIMIT`, `INPUT_VALIDATION`
- ⬜ Validator CVE checks on declared `DEPS` at parse time
- ⬜ Security context injected into every AI build session automatically
- ⬜ `enthropic audit` — standalone security report for a spec file

#### v0.5.0+ — Ecosystem
- ⬜ Template library — `enthropic new --template api|saas|cli|worker`
- ⬜ Community recipe collection — one `.enth` per project archetype
- ⬜ `enthropic recipes` — browse and pull community templates

## Spec

The `.enth` format is defined in [enthropic/SPEC.md](https://github.com/Enthropic-spec/enthropic/blob/main/SPEC.md).

---

[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey.svg)](LICENSE)
[![Node.js 20+](https://img.shields.io/badge/node-20+-brightgreen.svg)](https://nodejs.org)
