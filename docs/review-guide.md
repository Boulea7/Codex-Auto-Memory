# Review Guide

This guide helps reviewers, external agents, and code-audit tools quickly understand what matters in `codex-auto-memory`.

## What this project is trying to prove

`codex-auto-memory` is not a generic note-taking tool. It is a companion system that tries to reproduce the observable product contract of Claude Code auto memory for current Codex releases.

A useful review should ask:

- Does the implementation actually behave like a Claude-style auto memory system?
- Are local Markdown files truly the primary interface?
- Is the current implementation safe enough to trust with repeated daily use?
- Is the project still positioned to migrate cleanly once native Codex memory stabilizes?

## Primary review surfaces

### 1. Product contract alignment

Read first:

- `docs/claude-reference.md`
- `README.md`
- `docs/architecture.md`

Check that the code still supports these core promises:

- local Markdown memory
- `MEMORY.md` as the compact startup entrypoint
- startup budget constrained around a 200-line mental model
- worktree-aware project memory sharing
- editable and auditable memory files
- a separate path for future native Codex migration

### 2. Runtime behavior

Read:

- `src/lib/commands/wrapper.ts`
- `src/lib/domain/startup-memory.ts`
- `src/lib/domain/rollout.ts`
- `src/lib/domain/sync-service.ts`

Review questions:

- Does startup injection avoid mutating user-tracked files?
- Can the wrapper identify the correct rollout for the just-finished session?
- Is sync idempotent or at least safely repeatable?
- Is audit data good enough for debugging mis-saved memory?

### 3. Memory storage contract

Read:

- `src/lib/domain/memory-store.ts`

Review questions:

- Are Markdown files human-readable and editable?
- Is `MEMORY.md` truly a concise index rather than a dump?
- Do topic files remain understandable without hidden sidecars?
- Are scope boundaries clear between `global`, `project`, and `project-local`?

### 4. Extractor quality

Read:

- `src/lib/extractor/prompt.ts`
- `src/lib/extractor/codex-extractor.ts`
- `src/lib/extractor/heuristic-extractor.ts`

Review questions:

- Does the extractor save stable, future-useful knowledge rather than transient task chatter?
- Can it remove or replace stale memory when contradicted?
- Does it avoid obvious sensitive or low-confidence content?
- Is the fallback path materially weaker than the preferred path, and is that acceptable?

### 5. Compatibility and migration

Read:

- `docs/native-migration.md`
- `src/lib/commands/doctor.ts`
- `src/lib/config/load-config.ts`

Review questions:

- Is the current architecture genuinely separable from the future native adapter?
- Are config precedence and storage safety constraints documented and implemented consistently?
- Does the repository avoid over-committing to unstable Codex internals?

## High-risk areas

- Rollout association in the presence of parallel sessions
- Incorrect tool output stitching when multiple calls share the same function name
- Silent memory pollution from temporary or speculative session content
- Drift between README promises and current CLI behavior
- Overfitting to current Codex rollout artifacts in a way that would make migration painful

## Suggested review order for other tools

1. Read `README.md`
2. Read `docs/claude-reference.md`
3. Read `docs/progress-log.md`
4. Read `CHANGELOG.md`
5. Inspect `src/lib/domain/rollout.ts`
6. Inspect `src/lib/domain/sync-service.ts`
7. Inspect `src/lib/domain/memory-store.ts`
8. Inspect extractor files
9. Run `pnpm test`

## Claude parity checklist

Use this checklist when deciding whether a change keeps the project aligned with Claude Code auto memory:

- Memory remains local and auditable
- `MEMORY.md` remains concise and startup-oriented
- Topic files remain the place for detail
- Project memory remains shared across worktrees
- Project-local memory remains isolated per worktree
- The system can express “remember”, “forget”, and “correct”
- Startup loading remains bounded and explicit
- Migration to native Codex support remains possible without changing the user mental model
