# Session Continuity

This document defines the temporary cross-session continuity layer in `codex-auto-memory`.

## Why this exists

Claude-style auto memory is optimized for stable, future-useful knowledge.
It is not a complete answer to the problem of resuming unfinished work after:

- context compaction
- a fresh conversation window
- a paused work session
- a worktree switch

Community setups for local coding agents often solve this by introducing a separate temporary session file. The most useful pattern observed in community practice is to preserve four categories:

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
- file modification notes now prefer repo-relative paths when rollout evidence includes absolute paths, and they also recognize both diff-style `apply_patch` text and managed `*** Update File:` / `*** Add File:` patch syntax
- generic latest requests such as bare `Continue` / `Run checks` / `Check it again` or vague proxy prompts like `Can you look into it?` no longer overwrite a persisted goal or synthesize a fake `incompleteNext` item when the rollout has no explicit next-step evidence; concrete question-style requests still count as meaningful goals/continuation targets

## Codex-backed extraction quality guardrails

`extractorMode=codex` is now the preferred continuity path, but it is still treated as a companion integration rather than a blind source of truth.

Current implementation rules:

- the prompt keeps the existing schema-first structure and now adds short evidence buckets for:
  - recent successful commands
  - recent failed commands
  - detected file writes
  - candidate explicit next steps
  - candidate explicit untried ideas
- reviewer warning hints now also cover more than package-manager drift: canonical-store posture, retrieval flow, and retrieval route order are treated as reviewer-visible conflict signals, while reference pointers and required services stay additive reviewer context instead of being forced into false conflicts
- Codex output must still pass local structural validation after the CLI writes JSON
- if the model output is malformed, missing required layers, or returns an evidence-empty summary while the rollout clearly contains command / file / next-step evidence, the system falls back to the heuristic summarizer
- `cam session save` and wrapper auto-save still prefer the latest primary project rollout and skip forked/subagent reviewer rollouts by default; explicit `cam session save --rollout <path>` still lets a reviewer target a specific file on purpose
- `cam session refresh` uses a different provenance selector:
  - explicit `--rollout <path>` always wins, including subagent rollouts
  - otherwise it checks, in order, a scope-matching pending continuity recovery marker, a scope-matching latest continuity audit entry, and then the latest primary project rollout
  - scope matching is exact: `both` only matches `both`
  - if a higher-priority matching marker or audit entry exists but its rollout file cannot be read, refresh fails instead of silently falling through to a lower-priority source
- refresh provenance is about regenerating the currently active continuity from a trusted source, not about generally “grabbing the latest session”

This keeps Codex-backed continuity as the primary quality path while preserving a deterministic local fallback for degraded sessions or brittle model output.

## Dream sidecar seam

The current implementation now exposes a minimal `dream sidecar` seam:

- `cam dream build`
- `cam dream inspect`

This sidecar is intentionally:

- additive
- JSON-only
- auditable
- fail-closed
- non-canonical

It can summarize continuity into a sidecar snapshot, surface query-time relevant durable refs, and stage pending promotion candidates, but it does **not** directly rewrite `MEMORY.md`, topic files, or the continuity Markdown files.

The reviewer-facing expansion around this seam is now split into three additive surfaces:

- `resumeContext` from `cam session status --json` / `cam session load --json`
- `querySurfacing` from `cam recall search --json`
- dream-sidecar review lanes such as `cam dream candidates` / `cam dream review` / `cam dream adopt` / `cam dream promote-prep` / `cam dream promote` / `cam dream apply-prep`

These surfaces are intentionally reviewer aids first. Subagent candidates start blocked and must be explicitly adopted before they enter the primary review lane. Durable-memory dream promote still requires explicit review and then flows through the existing reviewer/audit write path before canonical durable memory changes. Instruction-like `promote`, `promote-prep`, and `apply-prep` all remain `proposal-only`: they can stage or describe a proposed instruction update, emit a proposal bundle, and prepare manual-apply hints, but they never directly mutate instruction files.

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
cam session refresh
cam session load
cam session clear
cam session open
```

Command contract:

- `cam session save` keeps merge semantics and remains the same path used by wrapper auto-save
- `cam session refresh` ignores existing continuity during generation and replaces the selected scope from a fresh base state
- `cam session refresh` does not call `clear` before writing; replace means direct overwrite of the target state, not delete-then-save

`cam session load` now renders:

- shared project continuity
- project-local continuity
- the effective merged resume brief
- the latest continuity generation path and fallback status
- the latest continuity confidence and reviewer warnings when present
- the latest rollout path
- a small latest-generation drill-down for evidence counts and written continuity paths
- a compact prior-generation audit preview sourced from the continuity audit log that excludes the latest entry, coalesces consecutive repeats, and does not attempt to replay full prior history

`cam session status` now renders the latest generation path, the latest rollout path, the audit-log location, the same latest-generation drill-down, and the same compact prior-generation audit preview without printing the full shared/local continuity bodies.

`cam session status --json` and `cam session load --json` now also expose additive `resumeContext`, which includes the current goal, next steps, discovered instruction files, `suggestedDurableRefs`, and read-only `suggestedTeamEntries`. Those refs are resume hints only; they do not auto-promote sidecar candidates into durable memory.

`cam session refresh` renders a compact reviewer surface only:

- it does not print the full continuity body
- `--json` keeps the existing save payload shape and adds `action`, `writeMode`, and `rolloutSelection`
- default `scope=both` replaces both layers together; single-layer scopes only replace the targeted layer
- in `sessionContinuityLocalPathStyle="claude"` mode, replace rewrites the current active local file and does not delete historical `.tmp` files

Automatic injection and automatic saving are disabled by default.

This keeps the main Claude-style auto memory contract stable and prevents temporary state from silently entering every session unless the user explicitly opts in.

When wrapper auto-load is enabled, the public startup-layering order is kept explicit and stable:

- continuity
- instruction files
- dream refs
- top durable refs
- team/shared refs

## Continuity diagnostics audit

Continuity generation now keeps a separate reviewer-oriented audit log:

```text
~/.codex-auto-memory/projects/<project-id>/audit/session-continuity-log.jsonl
```

Each save, refresh, or wrapper auto-save records:

- whether the preferred path was `codex` or `heuristic`
- which path actually produced the saved continuity
- why Codex fell back when it did
- a compact `confidence` level plus reviewer warnings for conflict/noise cases
- evidence counts for commands, file writes, next steps, and untried items
- the rollout path and written continuity files
- `trigger`: `manual-save`, `manual-refresh`, or `wrapper-auto-save`
- `writeMode`: `merge` or `replace`

This information is intentionally **not** written into the continuity Markdown files themselves.

Reason:

- the continuity files should stay compact and human-editable
- reviewer/debug data belongs in an audit surface, not in the working-state note itself
- the latest audit entry now remains exposed explicitly as `latestContinuityAuditEntry` through `cam session save --json`, `cam session refresh --json`, `cam session load --json`, and `cam session status --json`
- the compatibility summary field `latestContinuityDiagnostics` still exposes the latest path/fallback view for existing consumers
- those same diagnostics now also expose `confidence` and reviewer warnings so consumers can distinguish explicit evidence from conservative fallback or noisy/contradictory rollouts
- the same commands now also expose raw recent audit entries so reviewers can verify a short audit window without opening the JSONL directly
- the default `load` / `status` text surfaces now show the latest rollout, the latest evidence counts and written paths, plus a compact prior audit preview without becoming a dedicated history browser
- compact prior audit preview grouping now includes normalized `trigger` and `writeMode`, so a save and a refresh from the same rollout are still shown as distinct reviewer events

Recovery marker rules stay narrow:

- a continuity recovery record is still written only when audit append fails
- a successful refresh clears only a logically matching marker
- unrelated markers stay visible
- recovery metadata may include `trigger` and `writeMode` for explanation, but identity matching still uses the existing logical provenance fields rather than those display-oriented fields

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

The compiled startup reviewer surface now also exposes explicit additive metadata:

- `sourceFiles`: only the source continuity files that actually rendered into the bounded startup block
- `candidateSourceFiles`: all candidate continuity files that were considered before the line budget was applied
- `sectionsRendered`: whether each startup section (`sources`, `goal`, `confirmedWorking`, `triedAndFailed`, `notYetTried`, `incompleteNext`, `filesDecisionsEnvironment`) actually rendered
- `omissions` / `omissionCounts`: reviewer-visible budget trimming for source provenance and sections
- `continuitySectionKinds` / `continuitySourceKinds`: compact structural summaries for what kinds of startup continuity were present
- `continuityProvenanceKind`: currently `temporary-continuity`
- `continuityMode`: currently `startup`
- `futureCompactionSeam`: a structured placeholder that marks where future compact/session-summary rebuilds should re-enter the startup contract

This keeps temporary continuity startup payloads reviewer-auditable in the same spirit as durable startup memory, while still keeping `cam session` separate from durable memory retrieval.

## Config: `sessionContinuityLocalPathStyle`

Controls the local-path layout for project-local continuity files.

- `"codex"` (default): stores state at `.codex-auto-memory/sessions/active.md` — a single fixed file inside the project root. Simple and deterministic.
- `"claude"`: stores state at `.claude/sessions/<date>-<short-id>-session.tmp` — a daily rotating tmp-style layout. Reading picks the most recently modified file; writing creates a new file with today's date.

Switch to `"claude"` only if you need interoperability with another tmp-style session layout in the same project directory.

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
- official public Codex docs clearly cover `AGENTS.md` layering, project-level `.codex/config.toml` overrides, and multi-agent workflows; local runtime observations additionally show handoff-oriented transcript context improvements
- local `cam doctor --json` on 2026-03-17 still reports `memories` and `codex_hooks` as `under development` and disabled, so native memory remains outside the current trusted path

Therefore the current implementation is:

- companion-first
- Codex-first in path defaults and command surface
- alternate path-style and workflow adapters remain available when needed
- wrapper-first in day-to-day operation, while future hook / skill / MCP-aware paths remain required to preserve the same continuity contract

External community patterns are useful reference material, but they do not override the Codex-first design rule.

## Research inputs

This design was informed by official Codex docs and local runtime surface checks:

- Codex CLI overview: <https://developers.openai.com/codex/cli>
- Codex feature maturity: <https://developers.openai.com/codex/feature-maturity>
- Codex config basics: <https://developers.openai.com/codex/config-basic>
- Codex config reference: <https://developers.openai.com/codex/config-reference>
- current local `memories` / `codex_hooks` readiness from `cam doctor`

These sources justify the current implementation choice:

- Codex-first path defaults
- wrapper-based startup injection
- optional automation rather than assuming stable native hooks
- future integration surfaces should consume continuity as auditable working state, not collapse it into opaque host-native session state
- the continuity startup contract should stay explicit about rendered provenance, section trimming, and rebuild boundaries instead of hiding them inside implementation details

### Community reference: `affaan-m/everything-claude-code`

The most useful ideas borrowed from that repository are:

- separating temporary session files from long-lived learned knowledge
- treating `PreCompact`, `SessionStart`, and end-of-session hooks as distinct lifecycle moments
- preserving a concise resume-oriented file instead of replaying whole transcripts

Important differences from this project:

- `codex-auto-memory` does **not** adopt `~/.claude/sessions/` as its primary canonical store
- `codex-auto-memory` keeps shared project continuity in the companion root so worktrees can share it safely
- Claude-style session file paths are supported only as an adapter path style, not as the main product model
- learned skills or hook-driven recall paths may eventually consume continuity outputs, but they are still downstream integration surfaces rather than part of the continuity body itself
