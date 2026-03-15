# Session Continuity

This document defines the temporary cross-session continuity layer in `codex-auto-memory`.

## Why this exists

Claude-style auto memory is optimized for stable, future-useful knowledge.
It is not a complete answer to the problem of resuming unfinished work after:

- context compaction
- a fresh conversation window
- a paused work session
- a worktree switch

Community Claude Code setups often solve this by introducing a separate temporary session file. The most useful pattern observed in community practice is to preserve four categories:

1. what is confirmed working
2. what has been tried and failed
3. what has not yet been tried
4. what remains incomplete or should happen next

`codex-auto-memory` adopts that idea as a **separate companion layer**, not as part of durable auto memory.

## Product boundary

Session continuity is:

- temporary
- resume-oriented
- Markdown-first
- editable and auditable
- optional

Session continuity is **not**:

- durable auto memory
- a full transcript archive
- a cloud sync feature
- a replacement for `MEMORY.md`

## Durable memory vs session continuity

Use durable auto memory for:

- stable commands
- lasting architecture decisions
- recurring debugging insights
- long-lived preferences

Use session continuity for:

- what is currently in progress
- what failed in this working thread
- what the next conversation should continue
- worktree-local environment notes

If information becomes stable and future-useful beyond the current thread, it should move into durable memory rather than stay in session continuity.

## Storage model

`codex-auto-memory` uses two continuity layers:

### Shared project continuity

Canonical shared state lives in the companion store:

```text
~/.codex-auto-memory/projects/<project-id>/continuity/project/active.md
```

This is the only continuity layer that is reliably shared across git worktrees.

### Project-local continuity

Project-local state lives in a hidden directory inside the current worktree.

Codex-first default:

```text
<project-root>/.codex-auto-memory/sessions/active.md
```

Claude-compatible adapter mode:

```text
<project-root>/.claude/sessions/<date>-<short-id>-session.tmp
```

The local layer is intended for worktree-specific or personally local state.

## Why the project-local layer is not the shared layer

Even when users prefer project-folder-local files, git worktrees do not provide a single shared filesystem path for all worktrees.

That means:

- project-folder-local storage is best for worktree-local continuity
- companion storage is still needed for cross-worktree shared continuity

This is why the implementation keeps both layers instead of trying to make one path do both jobs.

## Default behavior

Session continuity is available by command immediately:

```bash
cam session status
cam session save
cam session load
cam session clear
```

Automatic injection and automatic saving are disabled by default.

This keeps the main Claude-style auto memory contract stable and prevents temporary state from silently entering every session unless the user explicitly opts in.

## Startup behavior

When `sessionContinuityAutoLoad` is enabled, the wrapper injects a separate bounded block:

```text
# Session Continuity
```

This block:

- is distinct from durable auto memory
- has its own line budget
- is framed as temporary working state
- should be verified against the current codebase and user request

## Config boundary

Session continuity settings are treated as local behavior:

- allowed from managed config
- allowed from user config
- allowed from local config
- ignored from shared project config

This prevents a tracked repository config from forcing another user's local continuity behavior or file layout.

## Codex-first compatibility stance

The primary target is Codex.

Current Codex reality:

- rollout JSONL is available
- wrapper injection is available
- native `memories` and `codex_hooks` are still not publicly stable enough to depend on

Therefore the current implementation is:

- companion-first
- Codex-first in path defaults and command surface
- Claude-compatible through path-style and workflow adapters

Claude-specific community patterns are useful reference material, but they do not override the Codex-first design rule.

## Research inputs

This design was informed by three reference buckets:

### Official Claude Code docs

- memory contract
- settings boundary
- hook lifecycle
- subagent memory boundaries

Those sources justify keeping durable memory compact, auditable, and Markdown-first while treating temporary continuity as a separate companion concern.

### Official Codex docs and runtime surface

- Codex CLI, config, AGENTS, resume/fork, and feature flags
- current local `memories` / `codex_hooks` readiness from `cam doctor`

These sources justify the current implementation choice:

- Codex-first path defaults
- wrapper-based startup injection
- optional automation rather than assuming stable native hooks

### Community reference: `affaan-m/everything-claude-code`

The most useful ideas borrowed from that repository are:

- separating temporary session files from long-lived learned knowledge
- treating `PreCompact`, `SessionStart`, and end-of-session hooks as distinct lifecycle moments
- preserving a concise resume-oriented file instead of replaying whole transcripts

Important differences from this project:

- `codex-auto-memory` does **not** adopt `~/.claude/sessions/` as its primary canonical store
- `codex-auto-memory` keeps shared project continuity in the companion root so worktrees can share it safely
- Claude-style session file paths are supported only as an adapter path style, not as the main product model
