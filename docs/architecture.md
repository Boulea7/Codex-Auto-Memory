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

Current implementation note:

- startup injection quotes each active scope's `MEMORY.md` as local editable data rather than raw executable instructions
- startup injection also appends a structured `### Topic files` manifest with `{ scope, topic, path }` records for each available topic file
- full topic file content is not auto-injected; topic files remain the detail layer and are intended to be read on demand through normal file-read tools
- startup compilation does not parse topic entry bodies, which keeps the startup path compact and avoids eager full-topic loading

### Post-session sync path

1. The wrapper watches for new rollout files in `~/.codex/sessions/`.
2. After the session, it parses the relevant rollout JSONL.
3. A memory extractor proposes structured memory operations.
4. The Markdown store applies upserts and deletes to topic files.
5. `MEMORY.md` is rebuilt as a concise index for each scope.

### Optional session continuity path

1. `cam session save` or wrapper auto-save selects the latest relevant rollout.
2. A continuity summarizer extracts temporary working-state sections into two layers:
   - shared project continuity
   - project-local continuity
3. Shared continuity is written to the companion store.
4. Project-local continuity is written to a hidden local path and added to local git excludes.
5. If auto-load is enabled later, the wrapper injects a bounded temporary continuity block separately from durable memory.

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

## Session continuity layer

`codex-auto-memory` now distinguishes between two companion layers:

- durable auto memory: long-lived Markdown memory scoped as `global`, `project`, and `project-local`
- session continuity: temporary working-state Markdown used to resume work across conversations

Session continuity is intentionally **not** part of the durable memory contract:

- it captures incomplete work, tried-and-failed approaches, and next steps
- it should not rewrite or pollute `MEMORY.md`
- it can be enabled, loaded, or cleared independently of durable memory
- it keeps cross-worktree continuity separate from worktree-local resume notes

Current storage model:

- shared project continuity: `~/.codex-auto-memory/projects/<project-id>/continuity/project/active.md`
- Codex-first local continuity: `<project-root>/.codex-auto-memory/sessions/active.md`
- Claude-compatible local continuity (optional path style): `<project-root>/.claude/sessions/<date>-<short-id>-session.tmp`
- reviewer-oriented continuity diagnostics audit: `~/.codex-auto-memory/projects/<project-id>/audit/session-continuity-log.jsonl`

This split preserves cross-worktree sharing through the companion store while still supporting project-local hidden files for worktree-specific state.

Current continuity assignment rule:

- shared continuity carries repository-wide goal, confirmed working evidence, failed approaches, and project-wide prerequisites
- project-local continuity carries the exact next step, local file-edit notes, and worktree-specific experiments
- `cam session load` renders shared, local, and merged views separately so reviewers can see what is canonical versus local

## Injection strategy

Current Codex releases do not expose a complete native auto memory surface comparable to Claude Code. Until that changes, the startup injector should:

- avoid modifying tracked repository files
- compile memory externally
- inject it through the wrapper launch path
- quote injected memory as data so editable Markdown does not silently become policy or tool instructions

This is a compatibility-first design, not a permanent commitment to wrapper-only injection.

Session continuity follows the same companion-first approach:

- default mode is manual and explicit
- auto-load and auto-save are local behavior toggles, disabled by default
- project-shared config cannot force local session continuity behavior

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
