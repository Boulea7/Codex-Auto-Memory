# Codex Auto Memory

Claude-style auto memory for Codex, implemented as a local companion CLI.

`codex-auto-memory` aims to reproduce the product contract of Claude Code auto memory as closely as possible for today's Codex runtime: local Markdown memory files, automatic post-session note taking, compact startup injection, topic-file lookup on demand, optional cross-session continuity state, worktree-aware project sharing, and a clear migration path toward future native Codex memory features.

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
| Topic files on demand | Built in | No | Partial: startup injects structured topic file references and reads topic details on demand through normal file tools |
| Session continuity state | Community patterns only | No complete public contract | Yes, as an optional companion layer kept separate from durable memory |
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

When session continuity is enabled in local or user config, the wrapper can also inject and refresh a temporary working-state block that stays separate from durable memory.

### 5. Inspect memory

```bash
cam memory
cam session status
cam session save
cam session load --print-startup
cam remember "Always use pnpm instead of npm"
cam forget "old debug note"
cam audit
```

Current reviewer-oriented behavior:

- `cam memory` shows the active startup-loaded memory files, grouped topic refs for on-demand reads, startup budget usage, and the exact Markdown paths to edit per scope.
- `cam session load` shows shared project continuity, project-local continuity, the merged resume brief, the latest continuity generation path, and a compact recent generation preview sourced from the audit log.

## Architecture Overview

```text
Codex session
   |
   v
cam run / cam exec / cam resume
   |
   +--> compile startup memory from:
   |      global + project + project-local MEMORY.md
   |      + structured topic file references
   |      + optional temporary session continuity block
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

- Broader extractor fixtures and contradiction handling
- Richer `cam memory` and `cam session` inspection output
- Continuity generation diagnostics and reviewer audit surfaces
- Hook bridge helpers for emerging Codex hook support

### v0.3+

- Native Codex memory adapter once official APIs stabilize
- Optional GUI or TUI memory browser
- Cross-session diagnostics and confidence scoring

## Documentation

- [Changelog](CHANGELOG.md)
- [Claude reference contract](docs/claude-reference.md)
- [Architecture](docs/architecture.md)
- [Session continuity design](docs/session-continuity.md)
- [Native migration strategy](docs/native-migration.md)
- [Progress log](docs/progress-log.md)
- [Review guide](docs/review-guide.md)
- [Reviewer handoff](docs/reviewer-handoff.md)
- [Next phase brief](docs/next-phase-brief.md)
- [ClaudeCode patch audit](docs/claudecode-patch-audit.md)
- [Release checklist](docs/release-checklist.md)
- [Contributing](CONTRIBUTING.md)
- [Repository agent guide](AGENTS.md)

## Status

This project is intentionally opinionated: it favors the observable Claude Code auto memory contract over speculative abstractions. Where Codex native features are still incomplete, `codex-auto-memory` uses stable companion mechanisms first and leaves a clean adapter seam for future migration.

Current review-oriented status:

- baseline alpha bootstrap complete
- sync reliability hardening complete
- extractor quality hardening complete
- topic-aware startup lookup complete
- session continuity companion layer complete
- memory inspection UX hardening complete
- continuity diagnostics and reviewer audit surfaces complete
- native compatibility seams complete
- ClaudeCode patch batch audited and retained with documentation corrections
- repository privacy audit command added
- reviewer handoff packet available
