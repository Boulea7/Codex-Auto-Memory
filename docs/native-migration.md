# Native Migration Strategy

`codex-auto-memory` is built to work today without depending on unfinished Codex memory APIs, while still preparing for a future native transition.

## Current reality

Codex already exposes useful foundations:

- persistent session artifacts in `~/.codex/sessions/`
- resume and fork flows
- `AGENTS.md`, rules, skills, and project config
- experimental `memories` and `codex_hooks` feature flags

However, this is not yet the same as a complete public auto memory product surface.

## Migration objective

When official Codex memory and hooks stabilize, this project should migrate from a companion wrapper to a thinner native adapter with minimal user disruption.

## Non-negotiable compatibility seams

The implementation should keep these interfaces explicit:

- `SessionSource`: where session evidence comes from
- `MemoryExtractor`: how rollout evidence becomes memory operations
- `MemoryStore`: how Markdown memory is persisted
- `RuntimeInjector`: how startup memory reaches Codex

These seams allow us to replace only the native integration layer later.

## Planned migration phases

### Phase 1: Companion-first

- Use rollout JSONL as the session source
- Use wrapper commands to inject startup memory
- Use local Markdown as the stable store

### Phase 2: Hybrid

- Detect stable Codex hook support with `cam doctor`
- Allow optional native event hookups while keeping wrapper fallback
- Continue using the same Markdown store and scope rules

### Phase 3: Native-first

- Adopt official native memory or hook events for session boundaries
- Keep Markdown parity where possible
- Provide a migration command for any metadata or path adjustments

## What should stay stable across migration

- directory layout semantics
- scope semantics
- the 200-line startup contract
- topic file model
- user-facing commands for inspect / remember / forget

The goal is to preserve user trust. Native migration should change implementation plumbing, not the mental model of how memory works.

## Risks to monitor

- official Codex memory may choose a different startup loading model
- hook event shapes may differ from current assumptions
- native memory may not use Markdown as its primary surface

If native behavior diverges from Claude parity, this project should support both:

- a strict Claude-compatible mode
- a native-optimized mode

## Decision rule

Do not migrate purely because a native flag exists. Migrate when native Codex support is:

- publicly documented
- stable across releases
- testable in CI or deterministic local automation
- capable of preserving the core user contract this project promises
