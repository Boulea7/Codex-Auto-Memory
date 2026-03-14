# Codex Auto Memory

Claude-style auto memory for Codex, implemented as a local companion CLI.

`codex-auto-memory` aims to reproduce the product contract of Claude Code auto memory as closely as possible for today's Codex runtime: local Markdown memory files, automatic post-session note taking, compact startup injection, worktree-aware project sharing, and a clear migration path toward future native Codex memory features.

## Why this project exists

Claude Code already ships a complete auto memory system with a clear user contract:

- Claude writes memory notes automatically
- memory is stored as local Markdown
- `MEMORY.md` acts as the compact entrypoint
- only the first 200 lines are injected at startup
- detailed topic files are loaded on demand
- worktrees in the same repository share project memory
- `/memory` provides audit and editing controls

Codex already exposes strong building blocks such as `AGENTS.md`, skills, persistent sessions, rollout logs, and experimental `memories` / `codex_hooks` feature flags, but it does not yet expose the same complete auto memory product surface. This repository fills that gap.

## Goals

- Recreate Claude-style auto memory behavior for Codex with local, auditable Markdown files
- Keep project memory shared across git worktrees while preserving project-local notes
- Avoid modifying tracked files in user repositories just to inject startup context
- Stay compatible with future native Codex memory and hook capabilities

## Feature Matrix

| Capability | Claude Code | Codex today | Codex Auto Memory |
| :-- | :-- | :-- | :-- |
| Automatic memory writing | Built in | Not publicly complete | Yes, via companion sync flow |
| Local Markdown memory | Built in | No complete public contract | Yes |
| `MEMORY.md` startup entrypoint | Built in | No | Yes |
| 200-line startup budget | Built in | No | Yes |
| Topic files on demand | Built in | No | Yes |
| Worktree-shared project memory | Built in | No public contract | Yes |
| Audit and edit memory | `/memory` | No equivalent | `cam memory` |
| Native hooks / memory integration | Built in | Experimental / under development | Planned compatibility layer |

## Quick Start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Build the CLI

```bash
pnpm build
```

### 3. Initialize a project

```bash
cam init
```

This creates a tracked project config (`codex-auto-memory.json`) and documents how local overrides work with `.codex-auto-memory.local.json`.

### 4. Start Codex through the wrapper

```bash
cam run
```

This launches Codex with compiled startup memory and schedules a post-session memory sync when the session finishes.

### 5. Inspect memory

```bash
cam memory
cam remember "Always use pnpm instead of npm"
cam forget "old debug note"
```

## Architecture Overview

```text
Codex session
   |
   v
cam run / cam exec / cam resume
   |
   +--> compile startup memory from:
   |      global + project + project-local MEMORY.md
   |
   +--> launch codex with injected memory context
   |
   v
session ends
   |
   +--> parse rollout JSONL from ~/.codex/sessions/
   +--> extract stable future-useful knowledge
   +--> write Markdown topic files
   +--> rebuild MEMORY.md index
```

Primary storage layout:

```text
~/.codex-auto-memory/
├── global/
│   └── MEMORY.md
└── projects/<project-id>/
    ├── project/
    │   ├── MEMORY.md
    │   └── commands.md
    └── locals/<worktree-id>/
        ├── MEMORY.md
        └── workflow.md
```

See [docs/architecture.md](docs/architecture.md) for the full breakdown.

## Privacy and Safety

- Memory is local-first and machine-local by default.
- Markdown files are the primary truth, so users can audit or edit memory directly.
- Project config cannot redirect `autoMemoryDirectory`; only managed, user, or local config may do that.
- The extractor should store stable, future-useful knowledge rather than raw transcripts or temporary task state.
- This project aims to closely mimic Claude Code behavior, but it does **not** claim Anthropic or OpenAI native parity.

## Roadmap

### v0.1

- Companion CLI with `cam run`, `cam exec`, `cam resume`, `cam sync`, `cam memory`
- Markdown memory store with `MEMORY.md` index and topic files
- 200-line startup compiler
- Worktree-aware project identity
- Initial docs, CI, and open-source templates

### v0.2

- Better extractor prompts and operation deduplication
- Richer `cam memory` inspection output
- Hook bridge helpers for emerging Codex hook support

### v0.3+

- Native Codex memory adapter once official APIs stabilize
- Optional GUI or TUI memory browser
- Cross-session diagnostics and confidence scoring

## Documentation

- [Claude reference contract](docs/claude-reference.md)
- [Architecture](docs/architecture.md)
- [Native migration strategy](docs/native-migration.md)
- [Contributing](CONTRIBUTING.md)
- [Repository agent guide](AGENTS.md)

## Status

This project is intentionally opinionated: it favors the observable Claude Code auto memory contract over speculative abstractions. Where Codex native features are still incomplete, `codex-auto-memory` uses stable companion mechanisms first and leaves a clean adapter seam for future migration.
