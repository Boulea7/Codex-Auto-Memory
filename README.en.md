<div align="center">
  <h1>Codex Auto Memory</h1>
  <p><strong>A local-first companion CLI that brings Claude-style auto memory workflows to Codex</strong></p>
  <p>
    <a href="./README.md">简体中文</a> |
    <a href="./README.en.md">English</a>
  </p>
  <p>
    <a href="https://github.com/Boulea7/Codex-Auto-Memory/actions/workflows/ci.yml">
      <img alt="CI" src="https://github.com/Boulea7/Codex-Auto-Memory/actions/workflows/ci.yml/badge.svg" />
    </a>
    <a href="./LICENSE">
      <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg" />
    </a>
    <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white" />
    <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10.11.0-F69220?logo=pnpm&logoColor=white" />
    <a href="https://github.com/Boulea7/Codex-Auto-Memory/stargazers">
      <img alt="GitHub stars" src="https://img.shields.io/github/stars/Boulea7/Codex-Auto-Memory?style=social" />
    </a>
    <a href="https://github.com/Boulea7/Codex-Auto-Memory/issues">
      <img alt="GitHub issues" src="https://img.shields.io/github/issues/Boulea7/Codex-Auto-Memory" />
    </a>
  </p>
</div>

> `codex-auto-memory` is not a generic note-taking app and not a cloud memory service.
> Its job is to recreate the observable Claude Code auto memory contract for today's Codex runtime with local Markdown files, compact startup injection, topic-file lookup on demand, and a clean migration seam toward future native memory features.

---

**Three things to know up front:**

1. **What it does** — After each Codex session, it automatically extracts useful knowledge from the session log and writes it into local Markdown files. Those files are injected at next startup so Codex "remembers" your project.
2. **How it stores** — Everything is plain Markdown under `~/.codex-auto-memory/`. You can read, edit, and include it in code review at any time.
3. **Relation to Claude** — This is a companion CLI. It replicates the Claude Code auto memory workflow on top of Codex. It is not an Anthropic product and has no cloud component.

---

## Contents

- [Why this project exists](#why-this-project-exists)
- [Who this is for](#who-this-is-for)
- [Core capabilities](#core-capabilities)
- [Capability matrix](#capability-matrix)
- [Quick start](#quick-start)
- [Common commands](#common-commands)
- [How it works](#how-it-works)
- [Storage layout](#storage-layout)
- [Documentation hub](#documentation-hub)
- [Current status](#current-status)
- [Roadmap](#roadmap)
- [Contributing and license](#contributing-and-license)

## Why this project exists

Claude Code already exposes a fairly clear public auto memory contract:

- memory is written automatically by the assistant
- memory is stored as local Markdown
- `MEMORY.md` is the compact startup entrypoint
- only the first 200 lines are loaded at startup
- detail lives in topic files and is read on demand
- worktrees in the same repository share project memory
- `/memory` provides audit and edit controls

Codex already has useful primitives, but not the same complete public memory surface:

- `AGENTS.md`
- multi-agent workflows
- local persistent sessions and rollout logs
- local `cam doctor` / feature-output signals for `memories` and `codex_hooks`

`codex-auto-memory` fills that gap with a companion-first design and only a narrow compatibility seam instead of pretending native Codex memory is already ready for daily use. Near-term UX work stays focused on clearer `cam memory` / `cam session` reviewer flows.

## Who this is for

Good fit:

- Codex users who want a Claude-style auto memory workflow today
- teams that want fully local, auditable, editable Markdown memory
- maintainers who need worktree-shared project memory with worktree-local continuity
- projects that want the user mental model to stay stable even if official Codex surfaces evolve later

Not a good fit:

- users looking for a general note-taking or knowledge-base app
- teams that need account-level cloud memory
- users expecting full Claude `/memory` interaction depth today

## Core capabilities

| Capability | What it means |
| :-- | :-- |
| Automatic post-session sync | extracts stable knowledge from Codex rollout JSONL and writes it back into Markdown memory |
| Markdown-first memory | `MEMORY.md` and topic files are the product surface, not hidden cache |
| Compact startup injection | injects only the quoted `MEMORY.md` startup files that actually enter the payload, plus on-demand topic refs, instead of eager topic loading |
| Worktree-aware storage | shares project memory across worktrees while keeping local continuity isolated |
| Optional session continuity | separates temporary working state from durable memory |
| Reviewer surfaces | exposes `cam memory`, `cam session`, and `cam audit` for review and debugging |

## Capability matrix

| Capability | Claude Code | Codex today | Codex Auto Memory |
| :-- | :-- | :-- | :-- |
| Automatic memory writing | Built in | No complete public contract | Yes, via companion sync flow |
| Local Markdown memory | Built in | No complete public contract | Yes |
| `MEMORY.md` startup entrypoint | Built in | No | Yes |
| 200-line startup budget | Built in | No | Yes |
| Topic files on demand | Built in | No | Partial: startup exposes structured topic refs for later on-demand reads |
| Session continuity | Community patterns | No complete public contract | Yes, as a separate companion layer |
| Worktree-shared project memory | Built in | No public contract | Yes |
| Inspect / audit memory | `/memory` | No equivalent | `cam memory` |
| Native hooks / memory integration | Built in | Experimental / under development | Compatibility seam only |

`cam memory` is intentionally an inspection and audit surface. It exposes the quoted startup files that actually made it into the startup payload, currently the scoped `MEMORY.md` / index content, plus the startup budget, on-demand topic refs, edit paths, and recent durable sync audit events behind `--recent [count]`. Those topic refs are lookup pointers, not proof that topic bodies were eagerly loaded at startup.
Recent durable sync audit events now also surface conservatively suppressed conflict candidates so contradictory rollout output does not silently merge into durable memory.
Those recent sync events come from `~/.codex-auto-memory/projects/<project-id>/audit/sync-log.jsonl` and only cover sync-flow `applied`, `no-op`, and `skipped` events. Manual `cam remember` / `cam forget` updates stay outside that audit stream by design.
When primary memory files were written but the reviewer sidecar did not complete, `cam memory` will try to expose a pending sync recovery marker so reviewers can see that partial-success state explicitly; that marker is only cleared when the same rollout/session later completes successfully, not by an unrelated successful sync.
Explicit updates still happen through `cam remember`, `cam forget`, or direct Markdown edits rather than a `/memory`-style in-command editor.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/Boulea7/Codex-Auto-Memory.git
cd Codex-Auto-Memory
pnpm install
```

### 2. Build and link the global command

```bash
pnpm build
pnpm link --global
```

> After this, the `cam` command works in any directory.

### 3. Initialize inside your project

```bash
cd /your/project
cam init
```

This creates `codex-auto-memory.json` in your project root (committed to Git) and `.codex-auto-memory.local.json` locally (gitignored by default).

### 4. Launch Codex through the wrapper (memory starts working)

```bash
cam run
```

After each session ends, `cam` automatically extracts knowledge from the Codex rollout log and writes it into the memory files.

### 5. Inspect your memory

```bash
cam memory          # show active memory files and startup budget
cam session status  # show session continuity state
cam session refresh # regenerate continuity from provenance and replace the selected scope
cam remember "Always use pnpm instead of npm"   # manually record a preference
cam forget "old debug note"                     # remove a stale entry
cam audit           # check the repository for unexpected sensitive content
```

## Common commands

| Command | Purpose |
| :-- | :-- |
| `cam run` / `cam exec` / `cam resume` | compile startup memory and launch Codex through the wrapper |
| `cam sync` | manually sync the latest rollout into durable memory |
| `cam memory` | inspect the quoted startup files that actually entered the payload, on-demand topic refs, startup budget, edit paths, and durable sync audit events plus suppressed conflict candidates via `--recent [count]` |
| `cam remember` / `cam forget` | explicitly add or remove durable memory |
| `cam session save` | merge / incremental save; append rollout-derived continuity without cleaning stale state immediately |
| `cam session refresh` | replace / clean regeneration; rebuild continuity from the selected provenance and replace the selected scope |
| `cam session load` / `status` | continuity reviewer surface for the latest continuity diagnostics, including `confidence` / warnings when present, plus the latest audit drill-down, compact prior preview, and any pending continuity recovery marker |
| `cam session clear` / `open` | clear active continuity files or open the local continuity directory |
| `cam audit` | run privacy and secret-hygiene checks against the repository |
| `cam doctor` | inspect local companion wiring and native-readiness posture |

## Audit Surface Map

- `cam audit`: repository-level privacy and secret-hygiene audit.
- `cam memory --recent [count]`: durable sync audit for recent `applied`, `no-op`, and `skipped` sync events, without mixing in manual `remember` / `forget`; suppressed conflict candidates stay reviewer-visible here instead of silently merging.
- `cam session save`: the merge path for the continuity audit surface. It records the latest diagnostics, latest rollout, and latest audit drill-down, but it remains an incremental save and does not immediately clean polluted state.
- `cam session refresh`: the replace path for the continuity audit surface. It regenerates continuity from selected provenance and replaces the selected scope; `--json` additionally exposes `action`, `writeMode`, and `rolloutSelection`.
- `cam session load|status`: reviewer surface for the latest continuity diagnostics, latest rollout, latest audit drill-down, and a compact prior audit preview sourced from the continuity audit log that excludes the latest entry, coalesces consecutive repeats, and is not a full prior-history replay. Their `--json` output continues to expose raw recent audit entries, plus continuity `confidence` and warnings for conservative summaries.
- continuity reviewer warnings still belong to the audit/reviewer surface rather than the continuity body; the current implementation applies a minimal deterministic scrub so obvious reviewer warning prose is not written back into continuity Markdown.
- `pending continuity recovery marker`: a visible warning that continuity Markdown was written but the audit sidecar failed. It is not a general repair mechanism and is not equivalent to `cam session refresh`.

## How it works

### Design principles

- `local-first and auditable`
- `Markdown files are the product surface`
- `companion-first, with a narrow compatibility seam`
- `session continuity` stays separate from durable memory

### Runtime flow

```mermaid
flowchart TD
    A[Start Codex session] --> B[Compile startup memory]
    B --> C[Inject quoted MEMORY.md startup files plus on-demand topic refs]
    C --> D[Run Codex]
    D --> E[Read rollout JSONL]
    E --> F[Extract candidate durable memory operations]
    E --> G[Optional continuity summary]
    F --> H[Contradiction review and conservative suppression]
    H --> I[Update MEMORY.md and topic files]
    I --> J[Append durable sync audit]
    G --> K[Update shared and local continuity files]
```

### Why the project does not switch to native memory yet

- public Codex docs still do not define a full, stable native memory contract equivalent to Claude Code, and local `cam doctor --json` continues to treat `memories` / `codex_hooks` only as readiness signals rather than a trusted primary path
- local source inspection is useful when re-evaluating the compatibility seam, but not a stable product contract
- the repository therefore stays companion-first until public docs, runtime behavior, and CI-verifiable stability all improve together

## Storage layout

Durable memory:

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

Session continuity:

```text
~/.codex-auto-memory/projects/<project-id>/continuity/project/active.md
<project-root>/.codex-auto-memory/sessions/active.md
```

See the architecture docs for the full storage and boundary breakdown.

## Documentation hub

### Entry points

- [文档首页（中文）](docs/README.md)
- [Documentation Hub (English)](docs/README.en.md)

### Core design docs

- [Claude reference contract (中文)](docs/claude-reference.md) | [English](docs/claude-reference.en.md)
- [Architecture (中文)](docs/architecture.md) | [English](docs/architecture.en.md)
- [Native migration strategy (中文)](docs/native-migration.md) | [English](docs/native-migration.en.md)

### Maintainer and reviewer docs

- [Session continuity design](docs/session-continuity.md)
- [Release checklist](docs/release-checklist.md)
- [Contributing](CONTRIBUTING.md)

## Current status

Current public-ready status:

- durable memory companion path: available
- topic-aware startup lookup: available
- session continuity companion layer: available
- reviewer audit surfaces: available
- tagged GitHub Releases: available with tarball artifacts; npm publish remains manual
- native memory / native hooks primary path: not enabled and not trusted as the main implementation path

## Roadmap

### v0.1

- companion CLI
- Markdown memory store
- 200-line startup compiler
- worktree-aware project identity
- initial maintainer and reviewer docs

### v0.2

- stronger contradiction handling
- clearer `cam memory` and `cam session` reviewer UX
- tighter continuity diagnostics and reviewer packets, with explicit confidence and warning surfaces
- keep a compatibility seam for future hook surfaces

### v0.3+

- continue tracking official Codex memory and hook surfaces without implying a primary-path change
- optional GUI or TUI browser
- stronger cross-session diagnostics and confidence surfaces

## Contributing and license

- Contribution guide: [CONTRIBUTING.md](./CONTRIBUTING.md)
- License: [Apache-2.0](./LICENSE)

If you ever find a mismatch between the README, official docs, and local runtime observations, prefer:

1. official product documentation
2. verified local behavior
3. explicit uncertainty

over confident but weakly supported claims.
