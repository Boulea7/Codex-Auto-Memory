# Claude Code Auto Memory Reference

[简体中文](./claude-reference.md) | [English](./claude-reference.en.md)

> This document records the public Claude Code memory contract that `codex-auto-memory` intentionally tries to mirror.  
> It is not a reverse-engineering note about Anthropic internals, and it should not promote local observations or community patterns into official product guarantees.

## What this document answers

- what Claude Code publicly says about auto memory
- which behaviors matter most for parity in this repository
- which adjacent surfaces are relevant, but still should not be overclaimed

## One-page summary

| Public contract | What it means for this project |
| :-- | :-- |
| memory is local Markdown | the repository must stay Markdown-first and user-editable |
| `MEMORY.md` is the startup entrypoint | indexes must stay concise instead of becoming full dumps |
| startup only loads the first 200 lines | startup compilation must enforce a real line-budget mental model |
| topic files are read on demand | startup should not eagerly load topic bodies |
| worktrees share project memory | project identity cannot be derived only from the cwd |
| `/memory` exposes audit and edit controls | the project needs real inspect and edit paths, even if it does not fully clone Claude `/memory` |
| `autoMemoryDirectory` has config-scope boundaries | shared project config must not be able to hijack another user's memory path |

## Core public contract

The official Claude Code memory docs support a stable interpretation:

- Claude automatically saves memory notes for future sessions
- memory is stored locally, not as account-level cloud memory
- `MEMORY.md` is the compact entrypoint and topic files hold the detail layer
- users can inspect, edit, and delete memory

These are the core behaviors this repository should keep aligned with.

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
This repository does not currently claim full `/memory` interaction parity, but it still must preserve two things:

- users can see the actual memory files and active paths
- users can modify memory through Markdown files or explicit companion commands

### 6. `autoMemoryDirectory` has a configuration safety boundary

Claude's documented config behavior makes one design point clear: a shared project should not be able to redirect another user's memory writes.

For this project, that means:

- managed / user / local config may control the memory directory
- shared project config should not hijack the user's durable memory path

## Relevant but non-primary surfaces

### Subagent memory

Claude Code publicly documents separate persistent memory paths for subagents.  
That makes subagent memory a relevant parity surface, but not proof that this repository already has equivalent behavior.

### Hooks

Claude Code exposes a much richer hook lifecycle surface than current Codex.  
This is useful migration context, but not a reason to describe Codex hooks as effectively ready today.

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
- native migration remains a seam, not the primary path

## Official references

- Claude memory docs: <https://code.claude.com/docs/en/memory>
- Claude settings docs: <https://code.claude.com/docs/en/settings>
- Claude subagents docs: <https://code.claude.com/docs/en/sub-agents>
- Claude docs index: <https://code.claude.com/docs/llms.txt>
