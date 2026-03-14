# Architecture

This document describes the intended runtime architecture for `codex-auto-memory`.

## Design principles

- Local-first and auditable
- Minimal assumptions about unstable Codex internals
- Clean migration seam toward future native Codex memory
- Markdown files are part of the product surface, not an implementation detail

## High-level flow

### Startup path

1. `cam run`, `cam exec`, or `cam resume` resolves configuration.
2. The tool identifies the current project and worktree.
3. It reads `MEMORY.md` from three scopes:
   - global
   - project
   - project-local
4. It compiles a bounded startup payload, preserving a 200-line total budget.
5. It launches Codex with the compiled memory injected as editable context.

### Post-session sync path

1. The wrapper watches for new rollout files in `~/.codex/sessions/`.
2. After the session, it parses the relevant rollout JSONL.
3. A memory extractor proposes structured memory operations.
4. The Markdown store applies upserts and deletes to topic files.
5. `MEMORY.md` is rebuilt as a concise index for each scope.

## Storage model

Default layout:

```text
~/.codex-auto-memory/
├── global/
│   ├── MEMORY.md
│   └── preferences.md
└── projects/<project-id>/
    ├── project/
    │   ├── MEMORY.md
    │   ├── commands.md
    │   └── architecture.md
    ├── locals/<worktree-id>/
    │   ├── MEMORY.md
    │   └── workflow.md
    └── audit/
        └── sync-log.jsonl
```

## Memory scopes

### Global

Stores cross-project personal preferences and habits.

Examples:

- preferred package manager
- preferred testing cadence
- personal review or communication style

### Project

Stores repository-level durable knowledge shared across worktrees.

Examples:

- canonical build and test commands
- architectural constraints
- recurring debugging insights

### Project local

Stores more local, personal, or worktree-specific notes.

Examples:

- a local branch workflow
- a temporary but reusable local environment quirk
- machine-specific instructions that should not leak into shared project memory

## Markdown contract

The product surface is Markdown-first:

- `MEMORY.md` is the startup index
- topic files hold detailed entries
- users may inspect and edit files directly

The implementation may keep lightweight state for deduplication or sync bookkeeping, but it must not make the Markdown unreadable or secondary.

## Injection strategy

Current Codex releases do not expose a complete native auto memory surface comparable to Claude Code. Until that changes, the startup injector should:

- avoid modifying tracked repository files
- compile memory externally
- inject it through the wrapper launch path

This is a compatibility-first design, not a permanent commitment to wrapper-only injection.

## Extractor strategy

The preferred extractor path uses Codex itself in an ephemeral, schema-constrained mode to propose memory operations. A heuristic fallback exists for degraded environments.

The extractor should keep Claude-aligned selection rules:

- save stable future-useful facts
- do not save raw task transcripts
- do not save incomplete speculative guesses
- remove or revise stale memory when contradicted

## Testing targets

Minimum validation should cover:

- config precedence
- project and worktree identity
- Markdown read/write behavior
- `MEMORY.md` 200-line constraints
- rollout parsing
- startup payload compilation
- CLI wrapper behavior
