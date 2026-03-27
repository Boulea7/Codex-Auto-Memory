# Claude Code Auto Memory Reference

[简体中文](./claude-reference.md) | [English](./claude-reference.en.md)

> This document records the public Claude Code memory contract that `codex-auto-memory` intentionally mirrors where useful. It is not a reverse-engineering note about Anthropic internals, and it should not turn local observations or community patterns into official guarantees.

## What this document answers

- what Claude Code publicly says about auto memory
- which public behaviors still matter most for this repository
- where the repository now intentionally follows the contract in product semantics but not in host-specific implementation

## One-page summary

| Public contract | What it means for this project |
| :-- | :-- |
| memory is local Markdown | the repository must stay Markdown-first and user-editable |
| `MEMORY.md` is the startup entrypoint | indexes must stay concise instead of becoming full dumps |
| startup only loads the first 200 lines | startup compilation must enforce a real line-budget mental model |
| topic files are read on demand | startup should not eagerly load topic bodies |
| worktrees share project memory | project identity cannot be derived only from the cwd |
| `/memory` exposes audit and edit controls | the project needs real inspect and edit paths, even if it does not fully clone Claude `/memory` |
| `autoMemoryDirectory` should not be redirectable by shared project config | config boundaries should prevent a shared repository from hijacking a user-level memory path |
| the host may expose hooks, skills, and subagent memory | the repository should treat those as real integration targets when the host supports them |

## Core public contract

The official Claude Code memory docs support a stable interpretation:

- Claude automatically saves memory notes for future sessions
- memory is stored locally, not as account-level cloud memory
- `MEMORY.md` is the compact entrypoint and topic files hold the detail layer
- users can inspect, edit, and delete memory

These remain the core behaviors this repository should stay aligned with.

## Product behaviors to mirror

### 1. AI-managed local memory with user control

Claude Code presents auto memory as notes Claude writes for itself while working.
Good examples include:

- build and test commands
- debugging prerequisites and troubleshooting notes
- architecture constraints
- coding preferences
- workflow habits

It is not described as:

- full conversation replay
- account-level cloud memory
- a place to dump arbitrary temporary task state

### 2. `MEMORY.md` is the entrypoint, not the detail store

Each scope should have:

- one compact `MEMORY.md`
- zero or more topic files such as `commands.md` or `workflow.md`

`MEMORY.md` should tell the runtime where to look next, not carry the entire memory corpus inline.

### 3. The 200-line startup rule is the key operational constraint

Claude Code explicitly documents that only the first 200 lines of `MEMORY.md` are loaded at startup.

That directly implies:

- indexes must remain concise
- details belong in topic files
- topic files should be pulled on demand

This is why `codex-auto-memory` keeps startup injection compact and does not eagerly load topic entry bodies.

### 4. Project memory should be repository-scoped

Claude Code documents that:

- worktrees in the same repository share project memory
- subdirectories in the same repository share project memory
- different repositories do not share project memory

That means project identity should follow the git repository boundary, not only the current working directory.

### 5. Users must be able to inspect and edit memory

Claude Code exposes `/memory` as an audit and edit surface.
This repository still does not claim full `/memory` interaction parity, but it must preserve two things:

- users can see the actual memory files and active paths
- users can modify memory through Markdown files or explicit commands

### 6. `autoMemoryDirectory` has a configuration safety boundary

Claude-style public configuration boundaries also imply that a shared project should not be able to silently redirect another user's durable-memory storage.

For `codex-auto-memory`, that means:

- user, local, and managed config can control the memory directory
- shared project config must not be able to hijack a user-level memory path through `autoMemoryDirectory`
- host convenience should not weaken the repository's local-first safety boundary

### 7. Host-native breadth expands the host, not the memory model

Claude Code also exposes stronger host-native surfaces around memory:

- hooks
- skills
- subagents with persistent memory
- plugin packaging

For `codex-auto-memory`, this now means:

- those surfaces are worth targeting as future integration paths
- but the core product contract is still the Markdown memory contract itself
- the repository should not confuse host-native convenience with the canonical memory model

## Relevant but non-primary surfaces

### Subagent memory

Claude Code publicly documents separate persistent memory paths for subagents.
That makes subagent memory a relevant parity surface, but not proof that this repository already has equivalent behavior.

### Hooks

Claude Code exposes a much richer hook lifecycle surface than current Codex.
That is useful product reference material, and it is now relevant to this repository’s broader integration direction.
It still does **not** justify claiming that Codex native hooks are already ready.

### `/memory` depth

Claude `/memory` is a full interaction surface.
`codex-auto-memory` currently maps more closely to:

- `cam memory` for inspection and audit
- `cam remember` / `cam forget` for explicit updates
- direct Markdown edits for manual correction

That distinction should stay explicit in public docs.

## How this maps to Codex Auto Memory

This repository should continue to preserve these Claude-aligned rules:

- memory stays local, auditable, and Markdown-first
- `MEMORY.md` stays a compact startup index
- topic files stay the detail layer and are read on demand
- project memory remains worktree-shared
- session continuity stays separate from durable memory
- future hook / skill / MCP-aware integrations must preserve the same memory contract instead of replacing it
- native Codex migration remains only one branch of the strategy, not the whole strategy

## Official references

- Claude memory docs: <https://code.claude.com/docs/en/memory>
- Claude settings docs: <https://code.claude.com/docs/en/settings>
- Claude subagents docs: <https://code.claude.com/docs/en/sub-agents>
- Claude hooks docs: <https://code.claude.com/docs/en/hooks>
- Claude docs index: <https://code.claude.com/docs/llms.txt>
