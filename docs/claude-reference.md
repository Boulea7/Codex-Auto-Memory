# Claude Code Auto Memory Reference

This document captures the public Claude Code behavior that `codex-auto-memory` is intentionally trying to mimic.

## Core contract

According to the official Claude Code docs, every Claude Code session starts with a fresh context window, and knowledge persists across sessions through two complementary systems:

- `CLAUDE.md`: persistent instructions written by the user
- auto memory: memory notes written by Claude itself

Auto memory is presented as:

- local Markdown files
- automatically updated by Claude
- auditable and editable by the user
- loaded at startup through a compact `MEMORY.md`

## Product behaviors to mirror

### 1. AI-managed local memory

Claude Code describes auto memory as notes Claude writes for itself while working. These notes contain stable, future-useful information such as:

- build and test commands
- debugging insights
- architecture notes
- code style preferences
- workflow habits

It is not described as full conversation replay or cloud account memory.

### 2. `MEMORY.md` as the entrypoint

Each project gets a memory directory with:

- `MEMORY.md` as a concise index
- zero or more topic files such as `debugging.md` or `api-conventions.md`

`MEMORY.md` tracks what is stored where and is the primary startup entrypoint.

### 3. 200-line startup loading rule

Claude Code explicitly loads only the first 200 lines of `MEMORY.md` at the start of each conversation.

Important consequences:

- the index must stay concise
- detailed notes should move into topic files
- topic files are read only when needed

This is the most important operational constraint for parity.

### 4. Repository-scoped sharing

Claude Code documents that memory directories are derived from the git repository identity:

- all worktrees in the same repository share project memory
- subdirectories in the same repository share project memory
- different repositories do not share project memory

This means project identity must use the git common directory, not just the current working tree path.

### 5. User control and auditability

Claude Code exposes `/memory` so users can:

- view loaded memory files
- toggle auto memory
- open the memory folder
- edit or delete memory files

The product contract is explicit: auto memory is not a black box.

The official memory docs emphasize that auto memory is plain Markdown and can be edited or deleted through `/memory` or directly in the filesystem. In the official pages reviewed for this project, Anthropic documents manual audit and editing clearly, but does not provide a separate dedicated "forget" API contract in the same way it documents `remember`.

### 5b. Subagent memory behavior

Claude Code docs confirm that subagents maintain **independent** persistent memory, stored at separate paths:

- User scope: `~/.claude/agent-memory/<agent-name>/`
- Project scope: `.claude/agent-memory/<agent-name>/`
- Local scope: `.claude/agent-memory-local/<agent-name>/`

This means a subagent's memory does not merge into the parent session's auto memory unless the agent is explicitly designed to share state. The isolation is intentional.

For this project, the safe reference point is:

- subagents are a relevant parity surface
- persistent subagent memory exists in Claude Code and uses distinct paths per agent name
- the exact sharing semantics between parent-session memory and subagent memory should not be over-claimed unless verified from current official docs

### 5c. Lifecycle hooks

Claude Code supports 4 hook types: command hooks, HTTP hooks, prompt hooks, and agent hooks. The platform exposes 22+ lifecycle events. This is substantially richer than Codex's current hook surface (2 events: SessionStart and Stop, experimental only).

### 5d. `/memory` command capabilities

The `/memory` command provides:

- view loaded memory files
- toggle auto memory on/off
- open the memory folder in the file browser
- edit memory files directly

"Forget" is implemented as manual edit or delete via `/memory`, not as a dedicated `/forget` slash command. There is no `/forget` command in the official Claude Code product.

### 6. Configuration boundary for `autoMemoryDirectory`

Claude Code allows overriding the memory directory, but not from a project-shared settings file. The reason is security: a shared project should not be able to redirect another user's memory writes to an arbitrary path.

The `autoMemoryDirectory` setting is accepted from policy, local, and user configuration sources only. It is explicitly excluded from project-level config sources. This prevents a malicious or misconfigured project from hijacking where another user's memory is written.

This is a key design constraint and should be preserved in our Codex implementation.

## Scope model

Claude documentation references three memory scopes in the broader memory system:

- global
- project
- project local

The docs do not fully expand all semantics in the same section, but the general intent is clear:

- `global`: cross-project personal preferences
- `project`: repository-level durable knowledge
- `project local`: more local, personal, or worktree-specific project memory

## How this maps to Codex Auto Memory

`codex-auto-memory` should preserve the following Claude-aligned rules:

- memory is written automatically after useful work
- memory is Markdown-first and user-editable
- startup context is compact and line-budgeted
- project memory is shared across worktrees
- project config cannot redirect the main memory directory
- detailed notes belong in topic files, not the startup index

Session continuity can still be a useful companion augmentation, but it should be documented as exactly that: an extra companion layer for cross-conversation working state, not an official Claude Code auto memory contract claim.

## Reference links

- Claude memory docs: <https://code.claude.com/docs/en/memory>
- Claude settings docs: <https://code.claude.com/docs/en/settings>
- Claude subagents docs: <https://code.claude.com/docs/en/sub-agents>
- Documentation index: <https://code.claude.com/docs/llms.txt>
