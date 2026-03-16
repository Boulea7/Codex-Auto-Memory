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

In practice, a fifth category is also useful for continuity: files modified, key decisions made, and environment prerequisites that aid the next conversation without fitting cleanly into the four primary categories. The implementation stores this as `filesDecisionsEnvironment` and includes it in the compiled startup block.

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

## Continuity data model

The continuity summarizer now produces two summaries per save:

- `project`: the shared repository continuity layer
- `projectLocal`: the current worktree's local continuity layer

Each layer uses the same sections:

- `goal`
- `confirmedWorking`
- `triedAndFailed`
- `notYetTried`
- `incompleteNext`
- `filesDecisionsEnvironment`

Default assignment rules:

- `confirmedWorking` and `triedAndFailed` go to the shared project layer unless they are explicitly local-only
- exact next steps go to the local layer by default
- file modification notes go to the local layer by default
- project-wide prerequisites and decisions stay in the shared layer

## Codex-backed extraction quality guardrails

`extractorMode=codex` is now the preferred continuity path, but it is still treated as a companion integration rather than a blind source of truth.

Current implementation rules:

- the prompt keeps the existing schema-first structure and now adds short evidence buckets for:
  - recent successful commands
  - recent failed commands
  - detected file writes
  - candidate explicit next steps
  - candidate explicit untried ideas
- Codex output must still pass local structural validation after the CLI writes JSON
- if the model output is malformed, missing required layers, or returns an evidence-empty summary while the rollout clearly contains command / file / next-step evidence, the system falls back to the heuristic summarizer

This keeps Codex-backed continuity as the primary quality path while preserving a deterministic local fallback for degraded sessions or brittle model output.

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

`cam session load` now renders:

- shared project continuity
- project-local continuity
- the effective merged resume brief
- the latest continuity generation path and fallback status

Automatic injection and automatic saving are disabled by default.

This keeps the main Claude-style auto memory contract stable and prevents temporary state from silently entering every session unless the user explicitly opts in.

## Continuity diagnostics audit

Continuity generation now keeps a separate reviewer-oriented audit log:

```text
~/.codex-auto-memory/projects/<project-id>/audit/session-continuity-log.jsonl
```

Each save records:

- whether the preferred path was `codex` or `heuristic`
- which path actually produced the saved continuity
- why Codex fell back when it did
- evidence counts for commands, file writes, next steps, and untried items
- the rollout path and written continuity files

This information is intentionally **not** written into the continuity Markdown files themselves.

Reason:

- the continuity files should stay compact and human-editable
- reviewer/debug data belongs in an audit surface, not in the working-state note itself
- the latest audit entry is exposed through `cam session save --json`, `cam session load --json`, and `cam session status --json`

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

## Config: `sessionContinuityLocalPathStyle`

Controls the local-path layout for project-local continuity files.

- `"codex"` (default): stores state at `.codex-auto-memory/sessions/active.md` — a single fixed file inside the project root. Simple and deterministic.
- `"claude"`: stores state at `.claude/sessions/<date>-<short-id>-session.tmp` — daily rotating files that mimic Claude Code's session file naming convention. Reading picks the most recently modified file; writing creates a new file with today's date.

Switch to `"claude"` only if you need interoperability with Claude Code's session file layout in the same project directory.

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
- official public Codex surfaces now include `AGENTS.md` layering, project-level `.codex/config.toml` overrides, multi-agent workflows, and handoff-oriented transcript context improvements
- local `cam doctor --json` on 2026-03-17 still reports `memories` and `codex_hooks` as `under development` and disabled, so native memory remains outside the current trusted path

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
- learned skills / instincts remain future companion ideas, not part of the current durable memory or continuity contract
